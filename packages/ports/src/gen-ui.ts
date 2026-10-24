import type { JsonValue, PortError, Result } from "./common.js";

export type PropType = "string" | "number" | "boolean" | "money" | "string[]" | "json";

export interface PropSpec {
  readonly type: PropType;
  readonly required?: boolean;
  readonly description?: string;
  /** Allowed values for a `string` prop. */
  readonly enum?: readonly string[];
}

export interface ComponentSpec {
  /** For example `Stack`, `Metric`, `PledgeProgress`, `ActionButton`. */
  readonly name: string;
  readonly description: string;
  readonly props: { readonly [prop: string]: PropSpec };
  /** Component names allowed as children; empty or absent means no children. `"*"` allows any. */
  readonly children?: readonly string[];
  /** Capability tool names a node of this component may trigger. Absent means none. */
  readonly actions?: readonly string[];
}

/** The allow-list of what a generated interface may contain (AD-11). */
export interface ComponentLibrary {
  readonly name: string;
  readonly version: string;
  /** The component every document must start with. */
  readonly root: string;
  readonly components: readonly ComponentSpec[];
}

export interface UiAction {
  readonly tool: string;
  readonly input: JsonValue;
}

export interface UiNode {
  readonly component: string;
  readonly props: { readonly [prop: string]: JsonValue };
  readonly children: readonly UiNode[];
  readonly action?: UiAction;
}

/** A validated interface, safe to hand to the renderer. */
export interface UiDocument {
  readonly library: { readonly name: string; readonly version: string };
  readonly root: UiNode;
}

export type GenUiErrorCode =
  | "parse_error"
  | "invalid_root"
  | "unknown_component"
  | "invalid_props"
  | "invalid_children"
  | "forbidden_action";

export interface GenUiIssue {
  readonly code: GenUiErrorCode;
  /** Path of component names from the root, for example `Stack/Metric[1]`. */
  readonly path: string;
  readonly message: string;
}

export interface GenUiError extends PortError<GenUiErrorCode> {
  readonly issues: readonly GenUiIssue[];
}

/**
 * Generated interfaces (OpenUI). Model output is untrusted: it becomes a `UiDocument` only
 * if every node, prop, child and action is allowed by the component library. Owning epic: 11.
 */
export interface GenUi {
  /** The system prompt that teaches a model the library and the source language. Local, no gateway. */
  systemPrompt(library: ComponentLibrary): Promise<string>;
  /** Parse and validate model output (OpenUI Lang for the OpenUI adapter). */
  validate(library: ComponentLibrary, source: string): Promise<Result<UiDocument, GenUiError>>;
  /** Serialise a document back to source, for saved solutions. `validate(print(d))` yields `d`. */
  print(document: UiDocument): Promise<string>;
}
