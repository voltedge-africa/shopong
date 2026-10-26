import type { ComponentLibrary, ComponentSpec } from "@shopong/ports";

import { capabilityKindOf } from "./capabilities.js";

/**
 * A component of the library. It must say, explicitly, which capability it may read and which it may
 * trigger. An empty list means none, so a layout part declares `reads: []` and `actions: []`.
 */
export type BoundComponentSpec = ComponentSpec & {
  readonly reads: readonly string[];
  readonly actions: readonly string[];
};

export interface LibraryDefinition {
  readonly name: string;
  readonly version: string;
  /** The component every screen must start with. */
  readonly root: string;
  readonly components: readonly BoundComponentSpec[];
}

/** Thrown when a library definition breaks a rule. Lists every problem, not only the first. */
export class LibraryDefinitionError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`The component library is not valid:\n- ${problems.join("\n- ")}`);
    this.name = "LibraryDefinitionError";
    this.problems = problems;
  }
}

const COMPONENT_NAME = /^[A-Z][A-Za-z0-9]*$/;
const PROP_NAME = /^[a-z][A-Za-z0-9]*$/;
/** Positional slots OpenUI reserves for a component's parts and action. */
const RESERVED_PROPS = new Set(["children", "action"]);

/**
 * Checks a library definition and returns it as a port `ComponentLibrary`. Runs locally, once, when the
 * library is defined. It checks that names are well formed and unique, that every child names a
 * component (or `*`), that every enum sits on a string prop, and that each capability is one the
 * catalogue knows and is used the right way: reads only `read` tools, actions only `write` or `money`.
 */
export function createLibrary(definition: LibraryDefinition): ComponentLibrary {
  const problems: string[] = [];
  if (definition.name.trim() === "") problems.push("the library needs a name");
  if (definition.version.trim() === "") problems.push("the library needs a version");

  const names = new Set<string>();
  for (const component of definition.components) {
    const { name } = component;
    if (!COMPONENT_NAME.test(name)) {
      problems.push(
        `"${name}" is not a component name (letters and digits, starting with a capital)`,
      );
    }
    if (names.has(name)) problems.push(`${name} is declared twice`);
    names.add(name);
  }
  if (!names.has(definition.root))
    problems.push(`the root "${definition.root}" is not a component`);

  for (const component of definition.components) {
    const where = component.name;
    for (const [prop, spec] of Object.entries(component.props)) {
      if (!PROP_NAME.test(prop) || RESERVED_PROPS.has(prop)) {
        problems.push(`${where}.${prop} is not a usable prop name`);
      }
      if (spec.enum !== undefined && (spec.type !== "string" || spec.enum.length === 0)) {
        problems.push(`${where}.${prop} has an enum, which needs a non-empty string prop`);
      }
    }

    const children = component.children ?? [];
    if (children.includes("*") && children.length > 1) {
      problems.push(`${where} lists "*" with other children`);
    }
    for (const child of children) {
      if (child !== "*" && !names.has(child))
        problems.push(`${where} allows an unknown child ${child}`);
    }

    for (const tool of component.reads) {
      const kind = capabilityKindOf(tool);
      if (kind === undefined)
        problems.push(`${where} reads "${tool}", which is not a known capability`);
      else if (kind !== "read")
        problems.push(`${where} reads "${tool}", a ${kind} capability, not a read`);
    }
    for (const tool of component.actions) {
      const kind = capabilityKindOf(tool);
      if (kind === undefined)
        problems.push(`${where} acts through "${tool}", which is not a known capability`);
      else if (kind === "read")
        problems.push(`${where} acts through "${tool}", a read, not an action`);
    }
    if (new Set(component.reads).size !== component.reads.length) {
      problems.push(`${where} lists a read twice`);
    }
    if (new Set(component.actions).size !== component.actions.length) {
      problems.push(`${where} lists an action twice`);
    }
  }

  if (problems.length > 0) throw new LibraryDefinitionError(problems);
  return {
    name: definition.name,
    version: definition.version,
    root: definition.root,
    components: definition.components,
  };
}
