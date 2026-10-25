import { defineAction, type DefinedAction } from "@openuidev/lang-core";
import { z } from "zod/v4";
import type { ComponentLibrary, ComponentSpec, PropSpec } from "@shopong/ports";

import { actionNameOf } from "./names.js";

/** The positional slot a component's parts go in, after its props. */
export const CHILDREN = "children";
/** The positional slot a component's action goes in, after its parts. */
export const ACTION = "action";

export type ComponentDefinition = {
  readonly name: string;
  readonly description: string;
  readonly props: z.ZodObject;
};

/** What OpenUI needs to know about a library, derived from the port's own description of it. */
export type OpenUiDefinitions = {
  readonly root: string;
  readonly components: readonly ComponentDefinition[];
  readonly actions: readonly DefinedAction[];
  /** OpenUI action name to capability tool name: `MessageSend` to `message.send`. */
  readonly toolOfAction: ReadonlyMap<string, string>;
  /** Capability tool name to OpenUI action name. */
  readonly actionOfTool: ReadonlyMap<string, string>;
};

function schemaOf(prop: PropSpec): z.ZodType {
  const described = (schema: z.ZodType) =>
    prop.description === undefined ? schema : schema.describe(prop.description);
  switch (prop.type) {
    case "string":
      return described(prop.enum === undefined ? z.string() : z.enum([...prop.enum] as [string]));
    case "number":
      return described(z.number());
    case "boolean":
      return described(z.boolean());
    case "money":
      return described(z.object({ currency: z.string(), minor: z.number() }));
    case "string[]":
      return described(z.array(z.string()));
    case "json":
      return described(z.any());
  }
}

function propsOf(spec: ComponentSpec, actionRefs: ReadonlyMap<string, DefinedAction>): z.ZodObject {
  const shape: Record<string, z.ZodType> = {};
  for (const [name, prop] of Object.entries(spec.props)) {
    if (name === CHILDREN || name === ACTION) {
      throw new Error(`${spec.name}: "${name}" is the slot for parts and actions, not a prop name`);
    }
    const schema = schemaOf(prop);
    shape[name] = prop.required === true ? schema : schema.optional();
  }
  const allowed = (spec.children ?? []).filter((child) => child !== "*");
  if ((spec.children ?? []).length > 0) {
    const hint =
      allowed.length > 0 ? `Parts: ${allowed.join(", ")}.` : "Any part of the library, in order.";
    shape[CHILDREN] = z.array(z.any()).describe(hint);
  }
  const refs = (spec.actions ?? []).map((tool) => {
    const action = actionRefs.get(tool);
    if (action === undefined) throw new Error(`${spec.name}: no action for the tool "${tool}"`);
    return action.ref;
  });
  if (refs.length === 1) shape[ACTION] = refs[0]!.optional();
  else if (refs.length > 1) shape[ACTION] = z.union(refs as [z.ZodType, z.ZodType]).optional();
  return z.object(shape);
}

/**
 * The OpenUI form of the port's component library. Each component takes its props as positional
 * arguments in the order the port lists them, then its parts as one list, then its action:
 * `Button("Remind", "primary", @MessageSend())`. The same definitions build the checking library here
 * and the drawing library in the app, so the two cannot disagree.
 */
export function openUiDefinitions(library: ComponentLibrary): OpenUiDefinitions {
  const tools = [...new Set(library.components.flatMap((component) => component.actions ?? []))];
  const toolOfAction = new Map<string, string>();
  const actionOfTool = new Map<string, string>();
  const actionRefs = new Map<string, DefinedAction>();
  for (const tool of tools) {
    const name = actionNameOf(tool);
    if (toolOfAction.has(name)) throw new Error(`two tools would both be called @${name}`);
    toolOfAction.set(name, tool);
    actionOfTool.set(tool, name);
    actionRefs.set(
      tool,
      defineAction({
        name,
        description: `Runs the capability ${tool}. In a preview nothing really runs.`,
        params: z.object({ input: z.any().optional() }),
      }),
    );
  }
  return {
    root: library.root,
    components: library.components.map((spec) => ({
      name: spec.name,
      description: spec.description,
      props: propsOf(spec, actionRefs),
    })),
    actions: [...actionRefs.values()],
    toolOfAction,
    actionOfTool,
  };
}

/** One line per component, as the model and the person writing a screen see it: `Button(label, kind?, action?)`. */
export function signaturesOf(library: ComponentLibrary): string[] {
  return library.components.map((spec) => {
    const slots = [
      ...Object.entries(spec.props).map(([name, prop]) =>
        prop.required === true ? name : `${name}?`,
      ),
      ...((spec.children ?? []).length > 0 ? [CHILDREN] : []),
      ...((spec.actions ?? []).length > 0 ? [`${ACTION}?`] : []),
    ];
    return `${spec.name}(${slots.join(", ")})`;
  });
}
