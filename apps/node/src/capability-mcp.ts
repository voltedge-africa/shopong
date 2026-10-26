// The OCN Capability MCP server's core (story 11.2, AD-17, AGENTS rule 8). It is the `ToolRegistry` port: the only way an
// agent reaches a capability. Every tool has an input schema, one required ability and a kind (read, write or money).
//
// On every call, before anything runs, the server: finds the tool, checks the input, finds the community the input names,
// and checks the session's UCAN with the same `verifyAuthority` the record and the phone use (signature, chain, time,
// revocation, every grant still current, and the amount against the ceiling for money). Any failure is a refusal with a
// plain reason, written to the audit log with its code, and nothing runs.
//
// A money tool NEVER runs on the agent's call. It stores a pending confirmation and answers `needs_confirmation`. Only
// `confirm`, called with the verified identity of the member the session acts for, can run it: once, after the authority is
// checked again, keyed by the confirmation id. The agent has no way to call `confirm`: it is not a tool and it is not on the
// MCP route. A confirmation expires, and can be declined.
//
// No secret is read here. A tool's handler is injected by the Node; the server holds none.

import { z } from "zod";
import {
  isCurrentGrantIn,
  isRevokedIn,
  logTimeOf,
  verifyAuthority,
  type AuthorityProblem,
} from "@shopong/community";
import type {
  CapabilityAuth,
  CapabilityToken,
  Did,
  EpochMs,
  JsonValue,
  Money,
  PendingConfirmation,
  ToolCallContext,
  ToolCallResult,
  ToolDefinition,
  ToolRegistry,
} from "@shopong/ports";
import { nodeMessage, type AuthorityConfig } from "./authority.ts";

export type ToolKind = "read" | "write" | "money";

/** What a handler is told. `idempotencyKey` is the confirmation id for a money tool (AGENTS rule 5). */
export interface ToolRun {
  /** The member the session acts for. */
  readonly owner: Did;
  /** The agent's own identity (the token's audience). */
  readonly agent: Did;
  readonly space: string;
  readonly sessionId: string;
  readonly idempotencyKey?: string;
}

export interface CapabilityTool {
  readonly name: string;
  readonly description: string;
  readonly kind: ToolKind;
  /** The one ability the session's capability must grant, for example `ledger/read`. */
  readonly ability: string;
  /** The input, as a strict schema. It must contain a `space` (the community key). */
  readonly input: z.ZodType<{ readonly space: string }>;
  /** The amount a money tool would move: the token's ceiling is checked against it. */
  readonly amount?: (input: never) => Money;
  /** Plain words for the member's confirmation screen. Written by the server, never by the agent. */
  readonly summary?: (input: never) => string;
  readonly run: (input: never, ctx: ToolRun) => Promise<JsonValue>;
}

/** A tool whose type is checked at definition; the server then holds it type-erased. */
export function defineTool<S extends z.ZodType<{ readonly space: string }>>(spec: {
  readonly name: string;
  readonly description: string;
  readonly kind: ToolKind;
  readonly ability: string;
  readonly input: S;
  readonly amount?: (input: z.output<S>) => Money;
  readonly summary?: (input: z.output<S>) => string;
  readonly run: (input: z.output<S>, ctx: ToolRun) => Promise<JsonValue>;
}): CapabilityTool {
  return spec as unknown as CapabilityTool;
}

export type CapabilityProblem =
  | AuthorityProblem
  | "unknown_tool"
  | "invalid_input"
  | "unknown_space"
  | "not_delegated"
  | "too_many_pending"
  | "unknown_confirmation"
  | "confirmation_expired"
  | "already_decided"
  | "not_the_owner";

const MESSAGES: Record<
  | "unknown_tool"
  | "invalid_input"
  | "unknown_space"
  | "not_delegated"
  | "too_many_pending"
  | "unknown_confirmation"
  | "confirmation_expired"
  | "already_decided"
  | "not_the_owner",
  string
> = {
  unknown_tool: "That capability doesn't exist.",
  invalid_input: "The request isn't in the shape this capability accepts.",
  unknown_space: "This Node doesn't hold that community.",
  not_delegated: "This session must hold authority passed on to it, not one it made itself.",
  too_many_pending: "Too many requests are waiting for the member to approve.",
  unknown_confirmation: "There is nothing waiting with that number.",
  confirmation_expired: "That request waited too long. Ask again.",
  already_decided: "That request was already answered.",
  not_the_owner: "Only the member this session acts for can answer this.",
};

/** One line of the audit log. Never holds a token, a signature or an input value. */
export interface CapabilityAudit {
  readonly event: "call" | "confirmation_created" | "confirmation_answered";
  readonly outcome: "ok" | "refused" | "needs_confirmation" | "approved" | "declined" | "error";
  readonly tool?: string;
  readonly problem?: CapabilityProblem;
  readonly sessionId?: string;
  readonly actor?: Did;
  readonly confirmationId?: string;
}

export interface CapabilityServerOptions {
  readonly auth: CapabilityAuth;
  readonly tools: readonly CapabilityTool[];
  /** Finds the community a call names (its key), from the records this Node holds. */
  readonly scopeOf: (spaceKey: string) => Promise<AuthorityConfig | undefined>;
  /** The Node's own clock. Defaults to `Date.now`. */
  readonly now?: () => EpochMs;
  readonly audit?: (entry: CapabilityAudit) => void;
  /** How long a money request waits for the member. Default 15 minutes. */
  readonly confirmationTtlMs?: number;
  /** How many money requests may wait for one member at once. Default 20. */
  readonly maxPendingPerOwner?: number;
  /** Makes a confirmation id. Defaults to 16 random bytes in hex. */
  readonly newId?: () => string;
}

export type ConfirmDecision = "approve" | "decline";

export type ConfirmResult =
  | { readonly ok: true; readonly decision: "declined" }
  | { readonly ok: true; readonly decision: "approved"; readonly output: JsonValue }
  | {
      readonly ok: false;
      readonly problem: CapabilityProblem;
      readonly reason: string;
    }
  | { readonly ok: false; readonly problem: "run_failed"; readonly reason: string };

export interface CapabilityServer extends ToolRegistry {
  /**
   * The member's answer to a waiting money request. `approver` MUST be a verified identity (the Node's signed-request
   * check). Runs the tool at most once, after the authority is checked again.
   */
  confirm(id: string, approver: Did, decision: ConfirmDecision): Promise<ConfirmResult>;
  /** The requests waiting for a member, oldest first (for the member's confirmation screen). */
  pending(owner: Did): readonly PendingConfirmation[];
  /** The tools with their ability and kind, for the MCP listing. */
  catalogue(): readonly (ToolDefinition & { readonly ability: string; readonly kind: ToolKind })[];
}

interface Waiting {
  readonly id: string;
  readonly tool: CapabilityTool;
  readonly input: { readonly space: string };
  readonly token: CapabilityToken;
  readonly owner: Did;
  readonly agent: Did;
  readonly sessionId: string;
  readonly createdAt: EpochMs;
  readonly summary: string;
  /** Set synchronously before any await, so two answers can never both run the tool. */
  state: "waiting" | "approved" | "declined" | "failed";
}

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const DEFAULT_MAX_PENDING = 20;
/** Answered requests are remembered this many entries, so a repeat answer is refused as `already_decided`. */
const REMEMBER = 5000;

const randomId = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

export function createCapabilityServer(options: CapabilityServerOptions): CapabilityServer {
  const { auth } = options;
  const clock = options.now ?? Date.now;
  const ttl = options.confirmationTtlMs ?? DEFAULT_TTL_MS;
  const maxPending = options.maxPendingPerOwner ?? DEFAULT_MAX_PENDING;
  const newId = options.newId ?? randomId;
  const audit = options.audit ?? (() => undefined);
  const tools = new Map<string, CapabilityTool>();
  for (const tool of options.tools) {
    if (tools.has(tool.name)) throw new Error(`duplicate capability tool ${tool.name}`);
    if (tool.kind === "money" && (tool.amount === undefined || tool.summary === undefined)) {
      throw new Error(`money tool ${tool.name} needs an amount and a summary`);
    }
    tools.set(tool.name, tool);
  }
  const waiting = new Map<string, Waiting>();

  const definition = (tool: CapabilityTool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: z.toJSONSchema(tool.input) as JsonValue,
    money: tool.kind === "money",
    ability: tool.ability,
    kind: tool.kind,
  });

  type Checked =
    | { readonly ok: true; readonly owner: Did; readonly agent: Did }
    | { readonly ok: false; readonly problem: CapabilityProblem; readonly reason: string };

  /** The authority check, run at a call and again at an approval. */
  async function check(
    tool: CapabilityTool,
    input: { readonly space: string },
    token: CapabilityToken | undefined,
  ): Promise<Checked> {
    const refuse = (problem: CapabilityProblem, reason?: string): Checked => ({
      ok: false,
      problem,
      reason: reason ?? MESSAGES[problem as keyof typeof MESSAGES],
    });
    const scope = await options.scopeOf(input.space);
    if (scope === undefined) return refuse("unknown_space");
    const resource = `ocn:space/${input.space}`;
    const amount = tool.kind === "money" ? tool.amount?.(input as never) : undefined;
    const required = {
      with: resource,
      can: tool.ability,
      ...(amount === undefined ? {} : { ceiling: amount }),
    };
    const payload = token === undefined || token === "" ? undefined : await auth.decode(token);
    const leaf = payload?.ok ? payload.value : undefined;
    if (token === undefined || token === "" || leaf === undefined) {
      const problem = token === undefined || token === "" ? "missing_proof" : "tampered";
      return refuse(problem, nodeMessage(problem));
    }
    // A session's authority is passed on to it by a member. A token an identity made for itself is not that.
    if (leaf.issuer === leaf.audience) return refuse("not_delegated");
    const now = clock();
    const logTime = (await logTimeOf(scope.view)) ?? 0;
    const verified = await verifyAuthority(auth, token, {
      holder: leaf.audience,
      rootIssuer: scope.creator,
      at: Math.max(now, logTime),
      required,
      isRevoked: (id) => isRevokedIn(scope.view, id),
      isCurrentGrant: (who, id) => isCurrentGrantIn(scope.view, who, id),
    });
    if (!verified.ok) {
      const { code, at, limit } = verified.error;
      return refuse(
        code,
        nodeMessage(code, {
          ...(at === undefined ? {} : { at }),
          ...(limit === undefined ? {} : { limit }),
        }),
      );
    }
    return { ok: true, owner: leaf.issuer, agent: leaf.audience };
  }

  const pendingOf = (owner: Did) =>
    [...waiting.values()].filter((w) => w.owner === owner && w.state === "waiting");

  function sweep(now: EpochMs): void {
    for (const [id, w] of waiting) {
      if (w.state === "waiting" && now - w.createdAt >= ttl) waiting.delete(id);
    }
    // Keep the answered ones only to a bound.
    if (waiting.size > REMEMBER) {
      for (const [id, w] of waiting) {
        if (w.state !== "waiting") waiting.delete(id);
        if (waiting.size <= REMEMBER) break;
      }
    }
  }

  return {
    list: async () => [...tools.values()].map(definition),
    catalogue: () => [...tools.values()].map(definition),
    pending: (owner) =>
      pendingOf(owner).map((w) => ({
        id: w.id,
        tool: w.tool.name,
        input: w.input as JsonValue,
        summary: w.summary,
      })),

    async call(name, input, context: ToolCallContext): Promise<ToolCallResult> {
      const denied = (problem: CapabilityProblem, reason: string, actor?: Did): ToolCallResult => {
        audit({
          event: "call",
          outcome: "refused",
          tool: name,
          problem,
          sessionId: context.sessionId,
          ...(actor === undefined ? {} : { actor }),
        });
        return { status: "denied", reason };
      };
      const tool = tools.get(name);
      if (tool === undefined) return denied("unknown_tool", MESSAGES.unknown_tool);
      const parsed = tool.input.safeParse(input);
      if (!parsed.success) return denied("invalid_input", MESSAGES.invalid_input);
      const now = clock();
      sweep(now);

      const checked = await check(tool, parsed.data, context.capability);
      if (!checked.ok) return denied(checked.problem, checked.reason);
      const { owner, agent } = checked;
      const ran: ToolRun = {
        owner,
        agent,
        space: parsed.data.space,
        sessionId: context.sessionId,
      };

      if (tool.kind !== "money") {
        try {
          const output = await tool.run(parsed.data as never, ran);
          audit({
            event: "call",
            outcome: "ok",
            tool: name,
            sessionId: context.sessionId,
            actor: agent,
          });
          return { status: "ok", output };
        } catch {
          audit({
            event: "call",
            outcome: "error",
            tool: name,
            sessionId: context.sessionId,
            actor: agent,
          });
          return { status: "error", message: "That didn't work. Nothing was changed." };
        }
      }

      // A money tool: nothing runs. The request waits for the member.
      if (pendingOf(owner).length >= maxPending) {
        return denied("too_many_pending", MESSAGES.too_many_pending, agent);
      }
      const id = newId();
      const summary = tool.summary?.(parsed.data as never) ?? name;
      waiting.set(id, {
        id,
        tool,
        input: parsed.data,
        token: context.capability,
        owner,
        agent,
        sessionId: context.sessionId,
        createdAt: now,
        summary,
        state: "waiting",
      });
      audit({
        event: "confirmation_created",
        outcome: "needs_confirmation",
        tool: name,
        sessionId: context.sessionId,
        actor: agent,
        confirmationId: id,
      });
      return {
        status: "needs_confirmation",
        confirmation: { id, tool: name, input: parsed.data as JsonValue, summary },
      };
    },

    async confirm(id, approver, decision): Promise<ConfirmResult> {
      const fail = (problem: CapabilityProblem, reason?: string): ConfirmResult => {
        audit({
          event: "confirmation_answered",
          outcome: "refused",
          problem,
          actor: approver,
          confirmationId: id,
        });
        return { ok: false, problem, reason: reason ?? MESSAGES[problem as keyof typeof MESSAGES] };
      };
      const entry = waiting.get(id);
      if (entry === undefined) return fail("unknown_confirmation");
      // Only the member the session acts for answers. The agent is a different identity, so it can never.
      if (approver !== entry.owner || approver === entry.agent) return fail("not_the_owner");
      if (entry.state !== "waiting") return fail("already_decided");
      if (clock() - entry.createdAt >= ttl) {
        waiting.delete(id);
        return fail("confirmation_expired");
      }
      if (decision === "decline") {
        entry.state = "declined";
        audit({
          event: "confirmation_answered",
          outcome: "declined",
          actor: approver,
          confirmationId: id,
          tool: entry.tool.name,
        });
        return { ok: true, decision: "declined" };
      }
      // Claim it before any await: a second answer, even at once, finds it taken.
      entry.state = "approved";
      // The authority is checked again: it may have ended or been taken back while the request waited.
      const checked = await check(entry.tool, entry.input, entry.token);
      if (!checked.ok) {
        entry.state = "failed";
        return fail(checked.problem, checked.reason);
      }
      try {
        const output = await entry.tool.run(entry.input as never, {
          owner: entry.owner,
          agent: entry.agent,
          space: entry.input.space,
          sessionId: entry.sessionId,
          idempotencyKey: id,
        });
        audit({
          event: "confirmation_answered",
          outcome: "approved",
          actor: approver,
          confirmationId: id,
          tool: entry.tool.name,
        });
        return { ok: true, decision: "approved", output };
      } catch {
        entry.state = "failed";
        audit({
          event: "confirmation_answered",
          outcome: "error",
          actor: approver,
          confirmationId: id,
          tool: entry.tool.name,
        });
        return {
          ok: false,
          problem: "run_failed",
          reason: "That didn't work. Nothing was changed. Ask again.",
        };
      }
    },
  };
}
