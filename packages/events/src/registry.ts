// The event types of the first release (architecture.md section 6).
// Payload schemas are loose placeholders until the story that first writes a type
// replaces its entry in PayloadMap and PAYLOAD_VALIDATORS with a strict schema
// (member.invited and member.joined: story 2.3; role.granted: story 2.4). The envelope itself is strict (envelope.ts).

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

/** `member.invited`: the creator invited `invitee` with the `member/join` token whose id is `invitation`. */
export interface MemberInvitedPayload extends JsonObject {
  /** Token id of the invitation (`CapabilityAuth.tokenId`). */
  readonly invitation: string;
  /** `did:key` of the person invited. */
  readonly invitee: string;
  /** When the invitation ends, milliseconds since the Unix epoch. */
  readonly expiresAt: number;
}

/** `member.joined`: the actor joined with the invitation whose token id is `invitation`. */
export interface MemberJoinedPayload extends JsonObject {
  readonly invitation: string;
}

/**
 * `role.granted`: the actor gave `grantee` the named role until `expiresAt`. The proof is one delegation
 * token per ability of the role, each checked by `CapabilityAuth.verify` in `apply`.
 */
export interface RoleGrantedPayload extends JsonObject {
  /** A role name from the community's fixed list (`co-treasurer`, `driver`, `supplier`). */
  readonly role: string;
  /** `did:key` of the person given the role. */
  readonly grantee: string;
  /** When the role ends, milliseconds since the Unix epoch. */
  readonly expiresAt: number;
}

/** Payload shape per type. Placeholders until each type's owning story defines it. */
export type PayloadMap = { [T in EventType]: JsonObject } & {
  "member.invited": MemberInvitedPayload;
  "member.joined": MemberJoinedPayload;
  "role.granted": RoleGrantedPayload;
};

export interface Issue {
  /** JSONPath-like location, for example `$.payload.items[0]`. */
  readonly path: string;
  readonly message: string;
}

/** Validates a payload that is already known to be a canonicalisable plain object. */
export type PayloadValidator = (payload: JsonObject) => readonly Issue[];

const anyObject: PayloadValidator = () => [];

const DID_KEY = /^did:key:z[1-9A-HJ-NP-Za-km-z]+$/;

function requireString(
  payload: JsonObject,
  field: string,
  ok: (value: string) => boolean,
  message: string,
): Issue[] {
  const value = payload[field];
  if (value === undefined)
    return [{ path: `$.payload.${field}`, message: "required field is missing" }];
  return typeof value === "string" && ok(value) ? [] : [{ path: `$.payload.${field}`, message }];
}

const nonEmpty = (value: string): boolean => value.length > 0;

const memberInvited: PayloadValidator = (payload) => {
  const issues = [
    ...requireString(payload, "invitation", nonEmpty, "must be a non-empty token id"),
    ...requireString(payload, "invitee", (v) => DID_KEY.test(v), "must be a did:key"),
  ];
  const expiresAt = payload.expiresAt;
  if (expiresAt === undefined)
    issues.push({ path: "$.payload.expiresAt", message: "required field is missing" });
  else if (typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt) || expiresAt < 0)
    issues.push({
      path: "$.payload.expiresAt",
      message: "must be a non-negative integer of milliseconds",
    });
  return issues;
};

const memberJoined: PayloadValidator = (payload) =>
  requireString(payload, "invitation", nonEmpty, "must be a non-empty token id");

const roleGranted: PayloadValidator = (payload) => {
  const issues = [
    ...requireString(payload, "role", nonEmpty, "must be a non-empty role name"),
    ...requireString(payload, "grantee", (v) => DID_KEY.test(v), "must be a did:key"),
  ];
  const expiresAt = payload.expiresAt;
  if (expiresAt === undefined)
    issues.push({ path: "$.payload.expiresAt", message: "required field is missing" });
  else if (typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt) || expiresAt < 0)
    issues.push({
      path: "$.payload.expiresAt",
      message: "must be a non-negative integer of milliseconds",
    });
  return issues;
};

export const PAYLOAD_VALIDATORS: { readonly [T in EventType]: PayloadValidator } = {
  ...(Object.fromEntries(EVENT_TYPES.map((t) => [t, anyObject])) as {
    [T in EventType]: PayloadValidator;
  }),
  "member.invited": memberInvited,
  "member.joined": memberJoined,
  "role.granted": roleGranted,
};
