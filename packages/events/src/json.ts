// The JSON data model accepted by the canonical profile (see canonical.ts).
// Numbers must be safe integers; anything larger travels as a decimal string.

export type JsonPrimitive = null | boolean | number | string;
export type JsonArray = readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}
export type JsonValue = JsonPrimitive | JsonArray | JsonObject;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const DECIMAL_INTEGER = /^-?(?:0|[1-9][0-9]*)$/;

/** True for the one canonical decimal spelling of an integer: no "+", no leading zeros, no "-0". */
export function isDecimalIntegerString(value: unknown): value is string {
  return typeof value === "string" && DECIMAL_INTEGER.test(value) && value !== "-0";
}

/** Encode an integer of any size (money in cents, large counters) as a canonical decimal string. */
export function encodeBigInt(value: bigint): string {
  return value.toString(10);
}

/** Decode a canonical decimal string produced by `encodeBigInt`. Throws on any other spelling. */
export function decodeBigInt(value: string): bigint {
  if (!isDecimalIntegerString(value)) {
    throw new RangeError(`not a canonical decimal integer string: ${JSON.stringify(value)}`);
  }
  return BigInt(value);
}
