import type { CapabilityToken } from "./capability-auth.js";
import type { Did, JsonValue, PortError, Result } from "./common.js";

/** A tool the agent may call, as the OCN Capability MCP server describes it (AD-17). */
export interface ToolDefinition {
  /** For example `ledger.read`, `order.propose`. */
  readonly name: string;
  readonly description: string;
  /** JSON Schema for the input. */
  readonly inputSchema: JsonValue;
  /** Money tools never execute on an agent's call; they return `needs_confirmation`. */
  readonly money: boolean;
}

export interface ToolCallContext {
  readonly sessionId: string;
  /** The session's capability; the registry verifies it on every call. */
  readonly capability: CapabilityToken;
}

export interface PendingConfirmation {
  readonly id: string;
  readonly tool: string;
  readonly input: JsonValue;
  /** Human-readable summary for the confirmation screen. */
  readonly summary: string;
}

export type ToolCallResult =
  | { readonly status: "ok"; readonly output: JsonValue }
  | { readonly status: "needs_confirmation"; readonly confirmation: PendingConfirmation }
  | { readonly status: "denied"; readonly reason: string }
  | { readonly status: "error"; readonly message: string };

/**
 * The only way an agent reaches a capability: the OCN Capability MCP server, which
 * checks the capability on every call and turns money tools into confirmations.
 */
export interface ToolRegistry {
  list(): Promise<readonly ToolDefinition[]>;
  call(name: string, input: JsonValue, context: ToolCallContext): Promise<ToolCallResult>;
}

export interface SessionRequest {
  /** The member the agent acts for. */
  readonly owner: Did;
  /**
   * A short-lived capability strictly narrower than the owner's, delegated with
   * `CapabilityAuth.issue`. It is the only authority the session has.
   */
  readonly capability: CapabilityToken;
  readonly tools: ToolRegistry;
  readonly instructions?: string;
}

export interface ToolCallRecord {
  readonly tool: string;
  readonly input: JsonValue;
  readonly result: ToolCallResult;
}

export interface AgentTurn {
  /** `needs_confirmation` when at least one money tool is waiting for the member. */
  readonly status: "done" | "needs_confirmation";
  readonly reply: string;
  /** Every tool call made in this turn, in order. */
  readonly toolCalls: readonly ToolCallRecord[];
  readonly confirmations: readonly PendingConfirmation[];
}

export interface AgentSession {
  readonly id: string;
  prompt(text: string): Promise<AgentTurn>;
  close(): Promise<void>;
}

/**
 * The builder-layer agent runtime (OpenCode server mode or Pi, decision D-9), run in a
 * sandbox on the OCN Node. Owning epic: 11.
 *
 * Every adapter must: make tool calls only through the supplied registry, always passing
 * the session capability; never call tools the registry did not list; never retry or
 * work around a `needs_confirmation` or `denied` result.
 */
export interface Agent {
  startSession(
    request: SessionRequest,
  ): Promise<Result<AgentSession, PortError<"invalid_request">>>;
}
