// The "two platforms" acceptance criterion: the canonical bytes and the
// SHA-512 must not depend on the code path that produced them. Three
// implementations are compared: src/ (TypeScript, hand-rolled escaping and
// UTF-8), test/reference.ts (engine JSON.stringify, default sort, TextEncoder)
// and scripts/gen_vectors.py (Python, whose results are the golden vectors).
import { describe, expect, it } from "vite-plus/test";
import {
  canonicalBytes,
  canonicalize,
  encodeUtf8,
  sha512Hex,
  webCryptoSha512,
} from "../src/index.js";
import { buggyCanonicalizers, referenceCanonicalize } from "./reference.js";
import { vectors } from "./vectors.js";

const allAccepted = [...vectors.canonical.accept, ...vectors.events.accept];

describe("independent implementations agree on every golden vector", () => {
  for (const v of allAccepted) {
    it(v.name, async () => {
      const value: unknown = JSON.parse(v.input);
      const reference = referenceCanonicalize(value);
      expect(reference).toBe(v.canonical);
      expect(canonicalize(value)).toBe(reference);
      expect(canonicalBytes(value)).toEqual(new TextEncoder().encode(reference));
      const expected = "sha512" in v ? v.sha512 : v.eventId;
      expect(await sha512Hex(new TextEncoder().encode(reference), webCryptoSha512)).toBe(expected);
    });
  }

  it("the reference also rejects every reject vector", () => {
    for (const v of vectors.canonical.reject) {
      expect(() => referenceCanonicalize(JSON.parse(v.input)), v.name).toThrow();
    }
  });
});

describe("the vectors catch plausible platform mistakes", () => {
  for (const [mistake, buggy] of Object.entries(buggyCanonicalizers)) {
    it(mistake, () => {
      const caught = allAccepted.filter((v) => {
        try {
          return buggy(JSON.parse(v.input)) !== v.canonical;
        } catch {
          return true;
        }
      });
      expect(caught.length).toBeGreaterThan(0);
    });
  }

  it("code point sorting is caught only by the RFC 8785 sorting vector's astral key", () => {
    const buggy = buggyCanonicalizers["code point key sort (UTF-8 / UTF-32 order)"] as (
      v: unknown,
    ) => string;
    const caught = allAccepted
      .filter((v) => buggy(JSON.parse(v.input)) !== v.canonical)
      .map((v) => v.name);
    expect(caught).toEqual(["rfc8785 3.2.3 sorting"]);
  });
});

// Seeded generator (xorshift32): deterministic, so a failure is reproducible.
function generator(seed: number) {
  let s = seed >>> 0 || 1;
  const next = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)] as T;
  const pool = [
    "a",
    "B",
    "_",
    "1",
    "\u00e9",
    "\u00f6",
    "\u20ac",
    "\ufb33",
    "\uffff",
    "\ud83d\ude00",
    "\ud834\udd1e",
    "\u0000",
    "\n",
    '"',
    "\\",
    "/",
    "\u2028",
    " ",
  ];
  const str = () => Array.from({ length: Math.floor(next() * 6) }, () => pick(pool)).join("");
  const int = () =>
    pick([0, 1, -1, 42, 9007199254740991, -9007199254740991, Math.floor((next() - 0.5) * 1e12)]);
  const value = (depth: number): unknown => {
    const r = next();
    if (depth > 4 || r < 0.35) return pick([null, true, false, int(), str()]);
    if (r < 0.65) return Array.from({ length: Math.floor(next() * 4) }, () => value(depth + 1));
    const o: Record<string, unknown> = {};
    for (let i = Math.floor(next() * 5); i > 0; i--) o[str()] = value(depth + 1);
    return o;
  };
  return { value, next };
}

function shuffleKeys(value: unknown, next: () => number): unknown {
  if (Array.isArray(value)) return value.map((v: unknown) => shuffleKeys(v, next));
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value);
  for (let i = entries.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [entries[i], entries[j]] = [entries[j] as [string, unknown], entries[i] as [string, unknown]];
  }
  return Object.fromEntries(entries.map(([k, v]) => [k, shuffleKeys(v, next)]));
}

describe("generated values (500 seeded cases)", () => {
  it("both implementations agree, output is a fixed point, and key order does not matter", () => {
    const g = generator(0x0c0ffee);
    for (let i = 0; i < 500; i++) {
      const value = g.value(0);
      const text = canonicalize(value);
      expect(referenceCanonicalize(value)).toBe(text);
      expect(canonicalize(JSON.parse(text))).toBe(text);
      expect(canonicalize(shuffleKeys(value, g.next))).toBe(text);
      expect(encodeUtf8(text)).toEqual(new TextEncoder().encode(text));
    }
  });
});
