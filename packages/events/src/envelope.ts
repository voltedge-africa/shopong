// The one versioned event envelope: { v, type, space, actor, proof, claimedAt, nonce, payload }.
//
// Readers are forward compatible. An envelope with a type this reader does not
// know, or with v above ENVELOPE_VERSION, is an *opaque* event: valid, kept
// exactly as received (so its id does not change) and ignored by older logic.

import { canonicalize, CanonicalizationError } from "./canonical.js";
import { isPlainObject, type JsonObject, type JsonValue } from "./json.js";
import {
  isEventType,
  PAYLOAD_VALIDATORS,
  type EventType,
  type Issue,
  type PayloadMap,
} from "./registry.js";
import { decodeUtf8, encodeUtf8, Utf8Error } from "./utf8.js";

/** The highest envelope version this reader understands. */
export const ENVELOPE_VERSION = 1;

export const ENVELOPE_FIELDS = [
  "v",
  "type",
  "space",
  "actor",
  "proof",
  "claimedAt",
  "nonce",
  "payload",
] as const;

export interface EventEnvelope<T extends string = string, P extends JsonObject = JsonObject> {
  /** Envelope version: a positive integer. */
  readonly v: number;
  /** Lowercase dotted name, for example `order.proposed`. */
  readonly type: T;
  /** Autobase key of the community space: 64 lowercase hex characters (32 bytes). */
  readonly space: string;
  /** `did:key` of the participant who wrote the event. */
  readonly actor: string;
  /** Encoded UCAN chain authorising the event, invoking token first. Empty only for the space's root issuer. */
  readonly proof: readonly string[];
  /** Milliseconds since the Unix epoch (UTC) as claimed by the writer's clock. Not trusted as log time. */
  readonly claimedAt: number;
  /** Random bytes as lowercase hex, 16 to 64 bytes. Makes otherwise identical events distinct. */
  readonly nonce: string;
  readonly payload: P;
}

/** A v1 event of a known type, with its typed payload. */
export type KnownEvent = { [T in EventType]: EventEnvelope<T, PayloadMap[T]> }[EventType];

/** A valid envelope this reader cannot interpret. Extra top-level fields are allowed only when v > ENVELOPE_VERSION. */
export type OpaqueEvent = EventEnvelope & { readonly [extra: string]: JsonValue };

export type OpaqueReason = "unknown-type" | "future-version";

export type ParseResult =
  | { readonly ok: true; readonly known: true; readonly event: KnownEvent }
  | {
      readonly ok: true;
      readonly known: false;
      readonly reason: OpaqueReason;
      readonly event: OpaqueEvent;
    }
  | { readonly ok: false; readonly issues: readonly Issue[] };

const TYPE = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const MAX_TYPE_LENGTH = 64;
const SPACE_KEY = /^[0-9a-f]{64}$/;
const DID_KEY = /^did:key:z[1-9A-HJ-NP-Za-km-z]+$/;
const PROOF_TOKEN = /^[A-Za-z0-9_.-]+$/;
const NONCE = /^(?:[0-9a-f]{2}){16,64}$/;

/** Validate an already-parsed value as an event envelope. Never throws. */
export function parseEvent(value: unknown): ParseResult {
  if (!isPlainObject(value)) return fail("$", "event must be a JSON object");
  try {
    canonicalize(value);
  } catch (error) {
    if (error instanceof CanonicalizationError) return fail(error.path, error.message);
    throw error;
  }

  const issues: Issue[] = [];
  const e = value;
  for (const field of ENVELOPE_FIELDS) {
    if (!Object.hasOwn(e, field))
      issues.push({ path: `$.${field}`, message: "required field is missing" });
  }
  const check = (field: string, ok: boolean, message: string): void => {
    if (!ok && Object.hasOwn(e, field)) issues.push({ path: `$.${field}`, message });
  };

  check(
    "v",
    "v" in e && Number.isSafeInteger(e.v) && (e.v as number) >= 1,
    "must be an integer >= 1",
  );
  check(
    "type",
    "type" in e &&
      typeof e.type === "string" &&
      e.type.length <= MAX_TYPE_LENGTH &&
      TYPE.test(e.type),
    "must be a lowercase dotted name such as order.proposed",
  );
  check(
    "space",
    "space" in e && typeof e.space === "string" && SPACE_KEY.test(e.space),
    "must be 64 lowercase hex characters",
  );
  check(
    "actor",
    "actor" in e && typeof e.actor === "string" && DID_KEY.test(e.actor),
    "must be a did:key",
  );
  check(
    "proof",
    "proof" in e &&
      Array.isArray(e.proof) &&
      e.proof.every((t: unknown) => typeof t === "string" && PROOF_TOKEN.test(t)),
    "must be an array of encoded UCAN tokens",
  );
  check(
    "claimedAt",
    "claimedAt" in e && Number.isSafeInteger(e.claimedAt) && (e.claimedAt as number) >= 0,
    "must be a non-negative integer of milliseconds since the Unix epoch",
  );
  check(
    "nonce",
    "nonce" in e && typeof e.nonce === "string" && NONCE.test(e.nonce),
    "must be 16 to 64 bytes of lowercase hex",
  );
  check("payload", "payload" in e && isPlainObject(e.payload), "must be a JSON object");
  if (issues.length > 0) return { ok: false, issues };

  const v = e.v as number;
  const type = e.type as string;
  const event = value as unknown as OpaqueEvent;
  if (v > ENVELOPE_VERSION) return { ok: true, known: false, reason: "future-version", event };

  const extra = Object.keys(e).filter((k) => !(ENVELOPE_FIELDS as readonly string[]).includes(k));
  for (const key of extra)
    issues.push({ path: `$.${key}`, message: `unknown field in a v${v} envelope` });
  if (issues.length > 0) return { ok: false, issues };

  if (!isEventType(type)) return { ok: true, known: false, reason: "unknown-type", event };

  const payloadIssues = PAYLOAD_VALIDATORS[type](event.payload);
  if (payloadIssues.length > 0) return { ok: false, issues: payloadIssues };
  return { ok: true, known: true, event: event as unknown as KnownEvent };
}

/**
 * Decode wire bytes. The wire form *is* the canonical form: bytes that are not
 * exactly the canonical encoding of their own content (whitespace, key order,
 * `1.0`, duplicate keys, needless escapes, invalid UTF-8) are rejected, so the
 * event id of a decoded event is always the SHA-512 of the bytes received.
 */
export function decodeEvent(bytes: Uint8Array): ParseResult {
  let text: string;
  let value: unknown;
  try {
    text = decodeUtf8(bytes);
  } catch (error) {
    if (error instanceof Utf8Error) return fail("$", `invalid UTF-8: ${error.message}`);
    throw error;
  }
  try {
    value = JSON.parse(text);
  } catch {
    return fail("$", "not JSON");
  }
  const result = parseEvent(value);
  if (result.ok && canonicalize(result.event) !== text) {
    return fail("$", "not in canonical form (ocn-jcs-1)");
  }
  return result;
}

/** Wire bytes of an event: its canonical UTF-8 encoding. */
export function encodeEvent(event: EventEnvelope | OpaqueEvent): Uint8Array {
  return encodeUtf8(canonicalize(event));
}

export type EventFields<T extends EventType> = Omit<EventEnvelope<T, PayloadMap[T]>, "v">;

export class InvalidEventError extends Error {
  override name = "InvalidEventError";
  readonly issues: readonly Issue[];
  constructor(issues: readonly Issue[]) {
    super(issues.map((i) => `${i.path}: ${i.message}`).join("; "));
    this.issues = issues;
  }
}

/** Build a current-version event of a known type, validating it. Throws InvalidEventError. */
export function createEvent<T extends EventType>(
  fields: EventFields<T>,
): EventEnvelope<T, PayloadMap[T]> {
  const event = { v: ENVELOPE_VERSION, ...fields };
  const result = parseEvent(event);
  if (!result.ok) throw new InvalidEventError(result.issues);
  if (!result.known)
    throw new InvalidEventError([{ path: "$.type", message: "unknown event type" }]);
  return event;
}

function fail(path: string, message: string): ParseResult {
  return { ok: false, issues: [{ path, message }] };
}
