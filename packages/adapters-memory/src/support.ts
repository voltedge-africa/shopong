import type { Clock, EpochMs, IdGenerator, JsonValue } from "@shopong/ports";

/** 2026-01-01T00:00:00Z: the default start of a manual clock, so runs are reproducible. */
export const DEFAULT_EPOCH: EpochMs = Date.UTC(2026, 0, 1);

export interface ManualClock extends Clock {
  set(time: EpochMs): void;
  advance(ms: number): void;
}

/** A clock that only moves when told to. */
export function createManualClock(start: EpochMs = DEFAULT_EPOCH): ManualClock {
  let time = start;
  return {
    now: () => time,
    set: (next) => {
      time = next;
    },
    advance: (ms) => {
      time += ms;
    },
  };
}

/** Sequential ids: `<prefix>_1`, `<prefix>_2`, ... (a single counter across prefixes). */
export function createCounterIds(namespace = "mem"): IdGenerator {
  let n = 0;
  return {
    next: (prefix = namespace) => `${prefix}_${String(++n)}`,
  };
}

/** JSON with object keys sorted, for comparing request bodies. Not the event canonicaliser. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .filter((key) => record[key] !== undefined)
        .map((key) => [key, sortKeys(record[key])]),
    );
  }
  return value;
}

/** Deep copy of JSON data, so callers cannot mutate adapter state. */
export function cloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// cyrb53 (public domain). Fast and dependency-free so it runs on Hermes too.
function cyrb53(input: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

/**
 * A NON-CRYPTOGRAPHIC 128-bit hex digest. In-memory adapters use it to detect tampering in
 * tests and to derive stable ids. Never use it for real signatures, commitments or event ids.
 */
export function fakeDigest(input: string): string {
  return cyrb53(input, 1) + cyrb53(input, 2);
}

/** Compare strings by Unicode code point, which is the same as comparing their UTF-8 bytes. */
export function compareUtf8(a: string, b: string): number {
  const left = Array.from(a);
  const right = Array.from(b);
  const length = Math.min(left.length, right.length);
  for (let i = 0; i < length; i++) {
    const diff = (left[i]?.codePointAt(0) ?? 0) - (right[i]?.codePointAt(0) ?? 0);
    if (diff !== 0) return diff;
  }
  return left.length - right.length;
}
