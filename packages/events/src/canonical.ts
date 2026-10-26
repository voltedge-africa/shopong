// OCN canonical JSON: RFC 8785 (JSON Canonicalization Scheme) restricted to a
// smaller data model. Every output is also valid JCS output, so any conforming
// JCS implementation reproduces the same bytes for inputs we accept.
//
// Rules (docs/adr/0001-event-envelope-and-event-id.md is the normative text):
// - Values: null, true, false, strings, safe integers, arrays, plain objects.
// - Numbers: only Number.isSafeInteger values (|n| <= 2^53 - 1), written as
//   shortest decimal; -0 is written "0" (as in JCS). Floats, NaN, Infinity and
//   bigint are rejected: integers of any size travel as decimal strings.
// - Strings: well-formed UTF-16 only (lone surrogates are rejected). Escape
//   only `"`, `\` and U+0000..U+001F, using \b \t \n \f \r or \u00xx
//   (lowercase hex); everything else is written literally.
// - Objects: keys sorted by UTF-16 code units (not code points, not locale).
// - No whitespace. Output encoded as UTF-8 without BOM.
// - undefined, functions, symbols, sparse arrays, cycles, symbol keys and
//   non-plain objects (Date, Map, class instances) are rejected; toJSON is not
//   honoured.

import { encodeUtf8 } from "./utf8.js";

export const CANONICAL_PROFILE = "ocn-jcs-1";

/** Nesting deeper than this is rejected so hostile input cannot exhaust the stack. */
export const MAX_DEPTH = 64;

export class CanonicalizationError extends Error {
  override name = "CanonicalizationError";
  readonly path: string;
  constructor(message: string, path: string) {
    super(`${path}: ${message}`);
    this.path = path;
  }
}

/** Order two strings by UTF-16 code units, as RFC 8785 section 3.2.3 requires. */
export function compareUtf16(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = a.charCodeAt(i) - b.charCodeAt(i);
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

/** Canonical JSON text of `value`. Throws CanonicalizationError if `value` is outside the profile. */
export function canonicalize(value: unknown): string {
  return write(value, "$", 0, []);
}

/** UTF-8 bytes of the canonical JSON text: exactly what is hashed and what goes on the wire. */
export function canonicalBytes(value: unknown): Uint8Array {
  return encodeUtf8(canonicalize(value));
}

function write(value: unknown, path: string, depth: number, ancestors: object[]): string {
  switch (typeof value) {
    case "string":
      return writeString(value, path);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isSafeInteger(value)) {
        throw new CanonicalizationError(
          `number ${String(value)} is not a safe integer (floats, NaN, Infinity and |n| > 2^53-1 are not allowed; use a decimal string)`,
          path,
        );
      }
      return value === 0 ? "0" : String(value);
    case "bigint":
      throw new CanonicalizationError("bigint is not allowed; encode it with encodeBigInt", path);
    case "object":
      if (value === null) return "null";
      break;
    default:
      throw new CanonicalizationError(`${typeof value} is not a JSON value`, path);
  }

  if (depth >= MAX_DEPTH) throw new CanonicalizationError(`nesting deeper than ${MAX_DEPTH}`, path);
  if (ancestors.includes(value)) throw new CanonicalizationError("cyclic reference", path);
  ancestors.push(value);

  let out: string;
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (let i = 0; i < value.length; i++) {
      if (!(i in value)) throw new CanonicalizationError("sparse array", `${path}[${i}]`);
      items.push(write(value[i], `${path}[${i}]`, depth + 1, ancestors));
    }
    out = `[${items.join(",")}]`;
  } else {
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new CanonicalizationError("only plain objects and arrays are allowed", path);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new CanonicalizationError("symbol keys are not allowed", path);
    }
    const record = value as Record<string, unknown>;
    const members: string[] = [];
    for (const key of Object.keys(record).sort(compareUtf16)) {
      const childPath = `${path}.${key}`;
      members.push(
        `${writeString(key, childPath)}:${write(record[key], childPath, depth + 1, ancestors)}`,
      );
    }
    out = `{${members.join(",")}}`;
  }

  ancestors.pop();
  return out;
}

const SHORT_ESCAPES: Readonly<Record<number, string>> = {
  0x08: "\\b",
  0x09: "\\t",
  0x0a: "\\n",
  0x0c: "\\f",
  0x0d: "\\r",
  0x22: '\\"',
  0x5c: "\\\\",
};

function writeString(text: string, path: string): string {
  let out = '"';
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const low = text.charCodeAt(i + 1);
      if (!(low >= 0xdc00 && low <= 0xdfff)) {
        throw new CanonicalizationError(`lone surrogate at string index ${i}`, path);
      }
      out += text.slice(i, i + 2);
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      throw new CanonicalizationError(`lone surrogate at string index ${i}`, path);
    } else if (SHORT_ESCAPES[c] !== undefined) {
      out += SHORT_ESCAPES[c];
    } else if (c < 0x20) {
      out += `\\u00${c.toString(16).padStart(2, "0")}`;
    } else {
      out += text[i];
    }
  }
  return `${out}"`;
}
