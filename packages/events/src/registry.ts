// The event types of the first release (architecture.md section 6).
// Payload schemas are deliberately loose placeholders: the story that first
// writes a type replaces its entry in PayloadMap and PAYLOAD_VALIDATORS with a
// strict schema. The envelope itself is strict (envelope.ts).

import type { JsonObject } from "./json.js";

export const EVENT_TYPES = [
  "member.invited",
  "member.joined",
  "member.removed",
  "role.granted",
  "role.revoked",
  "order.proposed",
  "order.approved",
  "order.closed",
  "quote.added",
  "quote.selected",
  "pledge.created",
  "payment.requested",
  "payment.completed",
  "payment.failed",
  "payment.refunded",
  "ledger.posted",
  "delivery.planned",
  "delivery.started",
  "delivery.confirmed",
  "collection.confirmed",
  "funding.requested",
  "funding.offered",
  "funding.accepted",
  "obligation.created",
  "obligation.settled",
  "solution.saved",
  "solution.shared",
  "agent.action",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

const KNOWN: ReadonlySet<string> = new Set(EVENT_TYPES);

/** True only for types this reader knows. Unknown types are still valid envelopes (see parseEvent). */
export function isEventType(value: unknown): value is EventType {
  return typeof value === "string" && KNOWN.has(value);
}

/** Payload shape per type. Placeholders until each type's owning story defines it. */
export type PayloadMap = { [T in EventType]: JsonObject };

export interface Issue {
  /** JSONPath-like location, for example `$.payload.items[0]`. */
  readonly path: string;
  readonly message: string;
}

/** Validates a payload that is already known to be a canonicalisable plain object. */
export type PayloadValidator = (payload: JsonObject) => readonly Issue[];

const anyObject: PayloadValidator = () => [];

export const PAYLOAD_VALIDATORS: { readonly [T in EventType]: PayloadValidator } =
  Object.fromEntries(EVENT_TYPES.map((t) => [t, anyObject])) as {
    [T in EventType]: PayloadValidator;
  };
