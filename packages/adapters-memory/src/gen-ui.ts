import {
  isMoney,
  ok,
  type ComponentLibrary,
  type ComponentSpec,
  type GenUi,
  type GenUiError,
  type GenUiIssue,
  type JsonValue,
  type PropSpec,
  type Result,
  type UiDocument,
  type UiNode,
} from "@shopong/ports";

/**
 * In-memory `GenUi`. Its source language is a JSON tree of
 * `{ component, props, children?, action? }` nodes; the OpenUI adapter uses OpenUI Lang
 * instead. Validation rules are the port's and identical for both.
 */
export class MemoryGenUi implements GenUi {
  async systemPrompt(library: ComponentLibrary): Promise<string> {
    const components = library.components.map((component) => {
      const props = Object.entries(component.props)
        .map(
          ([name, spec]) =>
            `${name}${spec.required === true ? "" : "?"}: ${spec.type}${spec.enum ? ` (${spec.enum.join("|")})` : ""}`,
        )
        .join(", ");
      const children = component.children?.length
        ? ` children: ${component.children.join(", ")}.`
        : "";
      const actions = component.actions?.length ? ` actions: ${component.actions.join(", ")}.` : "";
      return `- ${component.name}: ${component.description} props { ${props} }.${children}${actions}`;
    });
    return [
      `Reply with one JSON object describing a user interface built from the "${library.name}" library v${library.version}.`,
      'Each node is {"component": name, "props": {...}, "children": [nodes], "action": {"tool": name, "input": {...}}}.',
      `The root must be a ${library.root}. Use only these components:`,
      ...components,
    ].join("\n");
  }

  async validate(
    library: ComponentLibrary,
    source: string,
  ): Promise<Result<UiDocument, GenUiError>> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch {
      return reject([{ code: "parse_error", path: "", message: "source is not JSON" }]);
    }
    const shapeIssue = checkShape(parsed, "");
    if (shapeIssue !== undefined) return reject([shapeIssue]);
    const root = normalise(parsed as RawNode);
    const issues: GenUiIssue[] = [];
    if (root.component !== library.root) {
      issues.push({
        code: "invalid_root",
        path: root.component,
        message: `root must be ${library.root}`,
      });
    }
    const components = new Map(library.components.map((component) => [component.name, component]));
    checkNode(root, root.component, components, issues);
    if (issues.length > 0) return reject(issues);
    return ok({ library: { name: library.name, version: library.version }, root });
  }

  async print(document: UiDocument): Promise<string> {
    return JSON.stringify(document.root);
  }
}

interface RawNode {
  component: string;
  props?: { [prop: string]: JsonValue };
  children?: RawNode[];
  action?: { tool: string; input?: JsonValue };
}

function reject(issues: readonly GenUiIssue[]): { ok: false; error: GenUiError } {
  const first = issues[0];
  return {
    ok: false,
    error: { code: first?.code ?? "parse_error", message: first?.message ?? "invalid", issues },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkShape(value: unknown, path: string): GenUiIssue | undefined {
  if (!isObject(value) || typeof value.component !== "string") {
    return { code: "parse_error", path, message: "a node needs a component name" };
  }
  const here = path === "" ? value.component : `${path}/${value.component}`;
  if (value.props !== undefined && !isObject(value.props))
    return { code: "parse_error", path: here, message: "props must be an object" };
  if (
    value.action !== undefined &&
    !(isObject(value.action) && typeof value.action.tool === "string")
  ) {
    return { code: "parse_error", path: here, message: "action needs a tool name" };
  }
  if (value.children === undefined) return undefined;
  if (!Array.isArray(value.children))
    return { code: "parse_error", path: here, message: "children must be an array" };
  for (const child of value.children) {
    const issue = checkShape(child, here);
    if (issue !== undefined) return issue;
  }
  return undefined;
}

function normalise(raw: RawNode): UiNode {
  return {
    component: raw.component,
    props: raw.props ?? {},
    children: (raw.children ?? []).map(normalise),
    ...(raw.action === undefined
      ? {}
      : { action: { tool: raw.action.tool, input: raw.action.input ?? null } }),
  };
}

function propMatches(spec: PropSpec, value: JsonValue): boolean {
  switch (spec.type) {
    case "string":
      return typeof value === "string" && (spec.enum === undefined || spec.enum.includes(value));
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "money":
      return isMoney(value);
    case "string[]":
      return Array.isArray(value) && value.every((item) => typeof item === "string");
    case "json":
      return true;
  }
}

function checkNode(
  node: UiNode,
  path: string,
  components: Map<string, ComponentSpec>,
  issues: GenUiIssue[],
): void {
  const spec = components.get(node.component);
  if (spec === undefined) {
    issues.push({
      code: "unknown_component",
      path,
      message: `${node.component} is not in the library`,
    });
    return;
  }
  for (const [name, value] of Object.entries(node.props)) {
    const propSpec = spec.props[name];
    if (propSpec === undefined)
      issues.push({ code: "invalid_props", path, message: `unknown prop ${name}` });
    else if (!propMatches(propSpec, value))
      issues.push({
        code: "invalid_props",
        path,
        message: `prop ${name} must be ${propSpec.type}`,
      });
  }
  for (const [name, propSpec] of Object.entries(spec.props)) {
    if (propSpec.required === true && !(name in node.props)) {
      issues.push({ code: "invalid_props", path, message: `missing required prop ${name}` });
    }
  }
  if (node.action !== undefined && !(spec.actions ?? []).includes(node.action.tool)) {
    issues.push({
      code: "forbidden_action",
      path,
      message: `${node.component} may not trigger ${node.action.tool}`,
    });
  }
  const allowed = spec.children ?? [];
  node.children.forEach((child, i) => {
    const childPath = `${path}/${child.component}[${String(i)}]`;
    if (!allowed.includes("*") && !allowed.includes(child.component)) {
      issues.push({
        code: "invalid_children",
        path: childPath,
        message: `${node.component} may not contain ${child.component}`,
      });
    }
    checkNode(child, childPath, components, issues);
  });
}
