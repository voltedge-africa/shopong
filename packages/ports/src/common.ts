// Value types shared by every port. Pure TypeScript with no runtime dependencies, so it
// runs unchanged in React Native (Hermes), the browser and Node.

/** Brand a primitive so values with different meanings cannot be mixed up by accident. */
export type Brand<T, B extends string> = T & { readonly __brand: B };

/**
 * Event id: lowercase hex SHA-512 of the canonical JSON of an event (128 characters).
 * It is the idempotency key for every external side effect and the reconciliation key
 * across the record, the ledger, payments and the chain (AGENTS.md rule 5, AD-4).
 * `@shopong/events` computes it; ports only carry it.
 */
export type EventId = Brand<string, "EventId">;

/** Lowercase hex SHA-512 of some bytes, for example a document or photo. */
export type Sha512Hex = Brand<string, "Sha512Hex">;

const SHA512_HEX = /^[0-9a-f]{128}$/;

export function isEventId(value: unknown): value is EventId {
  return typeof value === "string" && SHA512_HEX.test(value);
}

/** Narrow a string to an `EventId`, throwing `TypeError` if it is not 128 lowercase hex characters. */
export function asEventId(value: string): EventId {
  if (!isEventId(value)) throw new TypeError(`not an event id (128 lowercase hex chars): ${value}`);
  return value;
}

export function isSha512Hex(value: unknown): value is Sha512Hex {
  return typeof value === "string" && SHA512_HEX.test(value);
}

/** Narrow a string to a `Sha512Hex`, throwing `TypeError` if it is not 128 lowercase hex characters. */
export function asSha512Hex(value: string): Sha512Hex {
  if (!isSha512Hex(value)) throw new TypeError(`not a SHA-512 hex digest: ${value}`);
  return value;
}

/** A decentralised identifier, for example `did:key:z6Mk...`. Participants are DIDs. */
export type Did = `did:${string}`;

export function isDid(value: unknown): value is Did {
  return typeof value === "string" && /^did:[a-z0-9]+:.+$/.test(value);
}

/** Milliseconds since the Unix epoch. Ports never read the wall clock themselves where determinism matters. */
export type EpochMs = number;

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/**
 * A port-level failure that callers are expected to handle (an unbalanced posting, an
 * expired capability, an unknown component). Infrastructure failures (network down,
 * service unavailable) are not `PortError`s: adapters reject the promise instead.
 */
export interface PortError<C extends string = string> {
  readonly code: C;
  readonly message: string;
}

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E extends PortError = PortError> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<C extends string>(code: C, message: string): Err<PortError<C>> {
  return { ok: false, error: { code, message } };
}

/** Stop receiving notifications. Calling it more than once is harmless. */
export type Unsubscribe = () => void;

/** Injected time source. Adapters take one so tests and replays are deterministic. */
export interface Clock {
  now(): EpochMs;
}

/** Injected id source. Adapters take one so tests and replays are deterministic. */
export interface IdGenerator {
  /** A new id, unique for the lifetime of the generator. `prefix` is a readability hint only. */
  next(prefix?: string): string;
}

/** ISO 4217 alphabetic code, for example `ZAR`. */
export type CurrencyCode = string;

/**
 * An amount of money in integer minor units of its currency (cents for ZAR). Never a
 * floating-point major amount. `minor` must be a safe integer; it may be negative only
 * where a port says so (balances).
 */
export interface Money {
  readonly currency: CurrencyCode;
  readonly minor: number;
}

const CURRENCY = /^[A-Z]{3}$/;

export function isMoney(value: unknown): value is Money {
  if (typeof value !== "object" || value === null) return false;
  const { currency, minor } = value as Record<string, unknown>;
  return typeof currency === "string" && CURRENCY.test(currency) && Number.isSafeInteger(minor);
}

/** Build a `Money`, throwing `TypeError` for a bad currency code or a non-integer amount. */
export function money(currency: CurrencyCode, minor: number): Money {
  const value = { currency, minor };
  if (!isMoney(value)) throw new TypeError(`invalid money: ${currency} ${String(minor)}`);
  return value;
}
