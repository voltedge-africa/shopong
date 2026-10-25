import {
  createLibrary,
  createStreamingParser,
  defineComponent,
  parseExpression,
  split,
  tokenize,
  walkAST,
  type ASTNode,
  type ElementNode,
  type Library,
  type LibraryJSONSchema,
  type ParseResult,
  type ValidationError,
} from "@openuidev/lang-core";
import {
  isMoney,
  ok,
  type ComponentLibrary,
  type ComponentSpec,
  type GenUi,
  type GenUiError,
  type GenUiErrorCode,
  type GenUiIssue,
  type JsonValue,
  type Result,
  type UiDocument,
  type UiNode,
} from "@shopong/ports";

import { ACTION, CHILDREN, openUiDefinitions, type OpenUiDefinitions } from "./definitions.js";
import { actionNameOf } from "./names.js";
import "./telemetry.js";

type Compiled = {
  readonly definitions: OpenUiDefinitions;
  readonly library: Required<Library>;
  readonly schema: LibraryJSONSchema;
  readonly specs: ReadonlyMap<string, ComponentSpec>;
  /** How many positional arguments each component takes. */
  readonly arity: ReadonlyMap<string, number>;
};

const compiled = new WeakMap<ComponentLibrary, Compiled>();

function compile(library: ComponentLibrary): Compiled {
  const cached = compiled.get(library);
  if (cached !== undefined) return cached;
  const definitions = openUiDefinitions(library);
  const openui = createLibrary({
    components: definitions.components.map((definition) =>
      defineComponent({ ...definition, component: null }),
    ),
    actions: [...definitions.actions],
    root: definitions.root,
  });
  const result: Compiled = {
    definitions,
    library: openui as Required<Library>,
    schema: openui.toJSONSchema(),
    specs: new Map(library.components.map((spec) => [spec.name, spec])),
    arity: new Map(
      definitions.components.map((definition) => [
        definition.name,
        Object.keys(definition.props.shape).length,
      ]),
    ),
  };
  compiled.set(library, result);
  return result;
}

/** The OpenUI library for a port library, with no drawing attached. For checking and prompts. */
export function openUiLibraryOf(library: ComponentLibrary): Required<Library> {
  return compile(library).library;
}

/* -------------------------------------------------------------------------- */
/* Checking                                                                    */
/* -------------------------------------------------------------------------- */

function reject(issues: readonly GenUiIssue[]): { ok: false; error: GenUiError } {
  const first = issues[0];
  return {
    ok: false,
    error: { code: first?.code ?? "parse_error", message: first?.message ?? "invalid", issues },
  };
}

const AST_KINDS = new Set([
  "Comp",
  "Str",
  "Num",
  "Bool",
  "Null",
  "Arr",
  "Obj",
  "Ref",
  "Ph",
  "StateRef",
  "RuntimeRef",
  "BinOp",
  "UnaryOp",
  "Ternary",
  "Member",
  "Index",
  "Assign",
]);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isAst = (value: unknown): value is ASTNode =>
  isObject(value) && typeof value["k"] === "string" && AST_KINDS.has(value["k"]);

const isElement = (value: unknown): value is ElementNode =>
  isObject(value) && value["type"] === "element" && typeof value["typeName"] === "string";

/** True if the value is plain data: no expressions, no references, no parts. */
function isPlain(value: unknown): value is JsonValue {
  if (value === null) return true;
  switch (typeof value) {
    case "string":
    case "boolean":
      return true;
    case "number":
      return Number.isFinite(value);
    case "object":
      if (isAst(value) || isElement(value)) return false;
      return Array.isArray(value)
        ? value.every(isPlain)
        : Object.values(value as Record<string, unknown>).every(isPlain);
    default:
      return false;
  }
}

/** A written-out value from an action's argument, or undefined if it is not just data. */
function literal(node: ASTNode): JsonValue | undefined {
  switch (node.k) {
    case "Str":
    case "Num":
    case "Bool":
      return node.v;
    case "Null":
      return null;
    case "UnaryOp": {
      const operand = node.operand;
      return node.op === "-" && operand.k === "Num" ? -operand.v : undefined;
    }
    case "Arr": {
      const items = node.els.map(literal);
      return items.some((item) => item === undefined) ? undefined : (items as JsonValue[]);
    }
    case "Obj": {
      const entries: [string, JsonValue][] = [];
      for (const [key, value] of node.entries) {
        const item = literal(value);
        if (item === undefined) return undefined;
        entries.push([key, item]);
      }
      return Object.fromEntries(entries);
    }
    default:
      return undefined;
  }
}

const ERROR_CODE: Record<string, GenUiErrorCode> = {
  "unknown-component": "unknown_component",
  "missing-required": "invalid_props",
  "null-required": "invalid_props",
  "type-mismatch": "invalid_props",
  "excess-args": "invalid_props",
  "inline-reserved": "parse_error",
  "unknown-function": "forbidden_action",
  "no-root": "invalid_root",
};

/**
 * The parser drops an argument a component has no slot for, and says only that there were too many.
 * Read the written call again to say what was put where it does not belong.
 */
function excessCode(source: string, error: ValidationError, arity: number): GenUiErrorCode {
  try {
    const statement = split(tokenize(source)).find((item) => item.id === error.statementId);
    if (statement === undefined) return "invalid_props";
    let code: GenUiErrorCode = "invalid_props";
    walkAST(parseExpression(statement.tokens), (node) => {
      if (node.k !== "Comp" || node.name !== error.component) return;
      for (const extra of node.args.slice(arity)) {
        if (extra.k === "Comp" && extra.fn === true) code = "forbidden_action";
        else if (
          extra.k === "Arr" &&
          code !== "forbidden_action" &&
          extra.els.some((item) => item.k === "Comp" || item.k === "Ref")
        )
          code = "invalid_children";
      }
    });
    return code;
  } catch {
    return "invalid_props";
  }
}

type Context = {
  readonly compiled: Compiled;
  readonly issues: GenUiIssue[];
};

function toAction(value: unknown, spec: ComponentSpec, path: string, context: Context) {
  if (value === null || value === undefined) return undefined;
  const { issues, compiled: current } = context;
  if (!isAst(value) || value.k !== "Comp" || value.fn !== true) {
    issues.push({
      code: "forbidden_action",
      path,
      message: "an action must be written @Name(...)",
    });
    return undefined;
  }
  const tool = current.definitions.toolOfAction.get(value.name);
  if (tool === undefined || !(spec.actions ?? []).includes(tool)) {
    issues.push({
      code: "forbidden_action",
      path,
      message: `${spec.name} may not trigger @${value.name}`,
    });
    return undefined;
  }
  const first = value.args[0];
  const input = first === undefined ? null : literal(first);
  if (input === undefined) {
    issues.push({
      code: "invalid_props",
      path,
      message: `the input of @${value.name} must be plain data`,
    });
    return undefined;
  }
  return { tool, input };
}

function toNode(element: ElementNode, path: string, context: Context): UiNode {
  const { issues, compiled: current } = context;
  const spec = current.specs.get(element.typeName);
  if (spec === undefined) {
    issues.push({
      code: "unknown_component",
      path,
      message: `${element.typeName} is not in the library`,
    });
    return { component: element.typeName, props: {}, children: [] };
  }
  const props: Record<string, JsonValue> = {};
  const children: UiNode[] = [];
  let action: UiNode["action"];
  for (const [name, value] of Object.entries(element.props)) {
    if (name === CHILDREN) {
      const items = Array.isArray(value) ? value : [];
      items.forEach((item, index) => {
        if (!isElement(item)) {
          issues.push({
            code: "invalid_children",
            path,
            message: `${spec.name} may only contain parts of the library`,
          });
          return;
        }
        const childPath = `${path}/${item.typeName}[${String(index)}]`;
        const allowed = spec.children ?? [];
        if (!allowed.includes("*") && !allowed.includes(item.typeName)) {
          issues.push({
            code: "invalid_children",
            path: childPath,
            message: `${spec.name} may not contain ${item.typeName}`,
          });
        }
        children.push(toNode(item, childPath, context));
      });
    } else if (name === ACTION) {
      action = toAction(value, spec, path, context);
    } else if (value !== null && value !== undefined) {
      if (isPlain(value)) props[name] = value;
      else
        issues.push({
          code: "invalid_props",
          path,
          message: `prop ${name} must be written out in full, not worked out`,
        });
    }
  }
  for (const [name, prop] of Object.entries(spec.props)) {
    if (prop.type === "money" && name in props && !isMoney(props[name])) {
      issues.push({ code: "invalid_props", path, message: `prop ${name} must be money` });
    }
  }
  return { component: spec.name, props, children, ...(action === undefined ? {} : { action }) };
}

/**
 * Parse a screen written in OpenUI Lang and check it against the library. This is the same parser the
 * renderer uses (`createStreamingParser`), plus the rules the parser leaves open: it is forgiving, and
 * a pinned screen must be exactly what the library allows.
 */
export function inspectScreen(
  library: ComponentLibrary,
  source: string,
): Result<UiDocument, GenUiError> {
  const current = compile(library);
  let parsed: ParseResult;
  try {
    parsed = createStreamingParser(current.schema, library.root).set(source, true);
  } catch {
    return reject([{ code: "parse_error", path: "", message: "the source could not be read" }]);
  }
  const issues: GenUiIssue[] = [];
  const meta = parsed.meta;
  if (meta.incomplete) {
    issues.push({ code: "parse_error", path: "", message: "the source stops half way" });
  }
  for (const error of meta.errors) {
    if (error.severity === "warning" && error.code !== "no-root") continue;
    const code =
      error.code === "excess-args"
        ? excessCode(source, error, current.arity.get(error.component) ?? 0)
        : (ERROR_CODE[error.code] ?? "parse_error");
    issues.push({ code, path: error.statementId ?? error.component, message: error.message });
  }
  if (meta.unresolved.length > 0) {
    issues.push({
      code: "parse_error",
      path: "",
      message: `${meta.unresolved.join(", ")} is used but never written`,
    });
  }
  if (meta.orphaned.length > 0) {
    issues.push({
      code: "parse_error",
      path: "",
      message: `${meta.orphaned.join(", ")} is written but never used`,
    });
  }
  if (
    parsed.queryStatements.length > 0 ||
    parsed.mutationStatements.length > 0 ||
    Object.keys(parsed.stateDeclarations).length > 0
  ) {
    issues.push({
      code: "forbidden_action",
      path: "",
      message: "a screen may not fetch data, change data or keep state of its own",
    });
  }
  if (parsed.root === null) {
    if (issues.length === 0) {
      issues.push({ code: "parse_error", path: "", message: "there is no screen in the source" });
    }
    return reject(issues);
  }
  if (parsed.root.typeName !== library.root) {
    issues.push({
      code: "invalid_root",
      path: parsed.root.typeName,
      message: `root must be ${library.root}`,
    });
  }
  const root = toNode(parsed.root, parsed.root.typeName, { compiled: current, issues });
  if (issues.length > 0) return reject(issues);
  return ok({ library: { name: library.name, version: library.version }, root });
}

/* -------------------------------------------------------------------------- */
/* Printing                                                                    */
/* -------------------------------------------------------------------------- */

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function write(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(write).join(", ")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, JsonValue>).map(
      ([key, item]) => `${IDENTIFIER.test(key) ? key : JSON.stringify(key)}: ${write(item)}`,
    );
    return `{${entries.join(", ")}}`;
  }
  return JSON.stringify(value);
}

const lowerFirst = (name: string): string => name.charAt(0).toLowerCase() + name.slice(1);

/** A document as canonical OpenUI Lang: the root first, then one statement for each part, in order. */
function printDocument(document: UiDocument, library: ComponentLibrary): string {
  const definitions = compile(library).definitions;
  const specs = new Map(library.components.map((spec) => [spec.name, spec]));
  const lines: string[] = [];
  const used = new Map<string, number>();
  const idFor = (node: UiNode, isRoot: boolean): string => {
    if (isRoot) return "root";
    const base = lowerFirst(node.component.replace(/[^A-Za-z0-9]/g, "")) || "part";
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    return `${base}${String(count)}`;
  };
  const emit = (node: UiNode, isRoot: boolean): string => {
    const id = idFor(node, isRoot);
    const index = lines.length;
    lines.push(""); // the statement keeps its place while its parts are written after it
    const spec = specs.get(node.component);
    const slots: string[] = [];
    const extras: string[] = [];
    const known = Object.keys(spec?.props ?? {});
    for (const name of known) {
      const value = node.props[name];
      slots.push(value === undefined ? "null" : write(value));
    }
    for (const [name, value] of Object.entries(node.props)) {
      if (!known.includes(name)) extras.push(write(value));
    }
    const childIds = node.children.map((child) => emit(child, false));
    const children = `[${childIds.join(", ")}]`;
    if ((spec?.children ?? []).length > 0) slots.push(children);
    else if (childIds.length > 0) extras.push(children);
    let action: string | undefined;
    if (node.action !== undefined) {
      const name = definitions.actionOfTool.get(node.action.tool) ?? actionNameOf(node.action.tool);
      action = `@${name}(${node.action.input === null ? "" : write(node.action.input)})`;
    }
    if ((spec?.actions ?? []).length > 0) slots.push(action ?? "null");
    else if (action !== undefined) extras.push(action);
    const all = [...slots, ...extras];
    while (all.length > 0 && all[all.length - 1] === "null") all.pop();
    lines[index] = `${id} = ${node.component}(${all.join(", ")})`;
    return id;
  };
  emit(document.root, true);
  return lines.join("\n");
}

/* -------------------------------------------------------------------------- */
/* The adapter                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * `GenUi` with OpenUI Lang as its source language. A screen is a few lines of `name = Part(...)`:
 * `Button("Remind", "primary", @MessageSend())`. Checking never calls a model and never touches the
 * network. Give it the libraries it should know: printing a document needs the order a part's props are
 * written in.
 */
export class OpenUiGenUi implements GenUi {
  private readonly libraries: readonly ComponentLibrary[];

  constructor(libraries: readonly ComponentLibrary[]) {
    this.libraries = libraries;
  }

  async systemPrompt(library: ComponentLibrary): Promise<string> {
    const actions = [...compile(library).definitions.toolOfAction.keys()].map((name) => `@${name}`);
    return compile(library).library.prompt({
      preamble: `You write screens for the "${library.name}" library, version ${library.version}, in OpenUI Lang.`,
      additionalRules: [
        `Reply with OpenUI Lang only. The first line is root = ${library.root}(...).`,
        "Write every part as a statement and refer to it by name inside its parent.",
        "Write every value out in full. Do not use $variables, Query, Mutation or expressions.",
        actions.length > 0
          ? `A button may only use these actions: ${actions.join(", ")}.`
          : "No part may trigger an action.",
      ],
    });
  }

  async validate(
    library: ComponentLibrary,
    source: string,
  ): Promise<Result<UiDocument, GenUiError>> {
    return inspectScreen(library, source);
  }

  async print(document: UiDocument): Promise<string> {
    const library = this.libraries.find(
      (item) => item.name === document.library.name && item.version === document.library.version,
    );
    if (library === undefined) {
      throw new Error(
        `unknown component library ${document.library.name} ${document.library.version}`,
      );
    }
    return printDocument(document, library);
  }
}
