import { describe, expect, it } from "vite-plus/test";
import {
  CanonicalizationError,
  canonicalBytes,
  canonicalize,
  compareUtf16,
  decodeBigInt,
  encodeBigInt,
  isDecimalIntegerString,
  sha512Hex,
  webCryptoSha512,
} from "../src/index.js";
import { vectors } from "./vectors.js";

describe("canonicalize: golden accept vectors", () => {
  for (const v of vectors.canonical.accept) {
    it(v.name, async () => {
      const text = canonicalize(JSON.parse(v.input));
      expect(text).toBe(v.canonical);
      expect(await sha512Hex(canonicalBytes(JSON.parse(v.input)), webCryptoSha512)).toBe(v.sha512);
      // Idempotent: canonical text is a fixed point.
      expect(canonicalize(JSON.parse(text))).toBe(text);
    });
  }
});

describe("canonicalize: golden reject vectors", () => {
  for (const v of vectors.canonical.reject) {
    it(v.name, () => {
      expect(() => canonicalize(JSON.parse(v.input))).toThrow(CanonicalizationError);
    });
  }
});

describe("canonicalize: values JSON text cannot express", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const sparse: number[] = [];
  sparse[2] = 1;
  const cases: [string, unknown][] = [
    ["undefined", undefined],
    ["undefined property", { a: undefined }],
    ["undefined in array", [undefined]],
    ["sparse array", sparse],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["bigint", 1n],
    ["function", () => 1],
    ["symbol", Symbol("s")],
    ["symbol key", { [Symbol("s")]: 1 }],
    ["Date", new Date(0)],
    ["Map", new Map()],
    ["Uint8Array", new Uint8Array(1)],
    ["class instance", new (class Point {})()],
    ["toJSON is not honoured", { toJSON: () => "x" }],
    ["cycle", cyclic],
  ];
  for (const [name, value] of cases) {
    it(`rejects ${name}`, () => {
      expect(() => canonicalize(value)).toThrow(CanonicalizationError);
    });
  }

  it("reports the path of the offending value", () => {
    expect(() => canonicalize({ payload: { items: [1, 2.5] } })).toThrow("$.payload.items[1]");
  });

  it("accepts null-prototype objects and shared (non-cyclic) references", () => {
    const shared = { a: 1 };
    const bare = Object.assign(Object.create(null) as object, { b: shared, a: shared });
    expect(canonicalize(bare)).toBe(canonicalize({ a: { a: 1 }, b: { a: 1 } }));
  });

  it("writes -0 as 0, as RFC 8785 does", () => {
    expect(canonicalize(-0)).toBe(canonicalize(0));
  });

  it("is independent of key insertion order", () => {
    expect(canonicalize({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalize({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });
});

describe("compareUtf16", () => {
  it("orders by UTF-16 code units, so an astral character sorts below U+E000..U+FFFF", () => {
    const astral = String.fromCodePoint(0x1f600);
    expect(compareUtf16(astral, "\ufb33")).toBeLessThan(0);
    expect(compareUtf16("a", "ab")).toBeLessThan(0);
    expect(compareUtf16("B", "a")).toBeLessThan(0);
    expect(compareUtf16("x", "x")).toBe(0);
  });
});

describe("bigint as decimal strings", () => {
  it("round-trips integers beyond 2^53", () => {
    for (const n of [0n, -1n, 2n ** 53n + 1n, -(10n ** 30n)]) {
      const s = encodeBigInt(n);
      expect(isDecimalIntegerString(s)).toBe(true);
      expect(decodeBigInt(s)).toBe(n);
    }
  });

  it("accepts only the one canonical spelling", () => {
    for (const s of ["", "-0", "+1", "01", "1.0", "1e3", " 1", "0x10"]) {
      expect(isDecimalIntegerString(s)).toBe(false);
      expect(() => decodeBigInt(s)).toThrow(RangeError);
    }
  });
});
