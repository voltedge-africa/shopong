// A second canonicaliser written along a deliberately different code path from
// src/canonical.ts: engine JSON.stringify for strings and numbers, the engine's
// default sort, a Unicode-mode regex for surrogates. Plus a family of plausible
// platform mistakes that the golden vectors must catch.

type Variant = {
  compareKeys?: (a: string, b: string) => number;
  writeString?: (s: string) => string;
};

const LONE_SURROGATE = /[\uD800-\uDFFF]/u;

function make(variant: Variant): (value: unknown) => string {
  const writeString = variant.writeString ?? ((s: string) => JSON.stringify(s));
  const sortKeys = (keys: string[]) =>
    variant.compareKeys ? keys.sort(variant.compareKeys) : keys.sort();
  const go = (value: unknown, depth: number): string => {
    if (value === null || typeof value === "boolean") return JSON.stringify(value);
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value)) throw new TypeError("not a safe integer");
      return JSON.stringify(value);
    }
    if (typeof value === "string") {
      if (LONE_SURROGATE.test(value)) throw new TypeError("lone surrogate");
      return writeString(value);
    }
    if (depth >= 64) throw new TypeError("too deep");
    if (Array.isArray(value)) return `[${value.map((v: unknown) => go(v, depth + 1)).join(",")}]`;
    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      return `{${sortKeys(Object.keys(record))
        .map((k) => {
          if (LONE_SURROGATE.test(k)) throw new TypeError("lone surrogate");
          return `${writeString(k)}:${go(record[k], depth + 1)}`;
        })
        .join(",")}}`;
    }
    throw new TypeError("not JSON");
  };
  return (value) => go(value, 0);
}

export const referenceCanonicalize = make({});

const codePoints = (s: string) => Array.from(s, (c) => c.codePointAt(0) as number);

export const buggyCanonicalizers: Record<string, (value: unknown) => string> = {
  "locale-sensitive key sort": make({ compareKeys: (a, b) => a.localeCompare(b) }),
  "code point key sort (UTF-8 / UTF-32 order)": make({
    compareKeys: (a, b) => {
      const x = codePoints(a);
      const y = codePoints(b);
      for (let i = 0; i < Math.min(x.length, y.length); i++) {
        if (x[i] !== y[i]) return (x[i] as number) - (y[i] as number);
      }
      return x.length - y.length;
    },
  }),
  "escape all non-ASCII": make({
    writeString: (s) =>
      JSON.stringify(s).replace(
        /[\u0080-\uffff]/g,
        (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
      ),
  }),
  "uppercase hex escapes": make({
    writeString: (s) =>
      JSON.stringify(s).replace(/\\u00([0-9a-f]{2})/g, (_, h: string) => `\\u00${h.toUpperCase()}`),
  }),
  "escape solidus": make({ writeString: (s) => JSON.stringify(s).replace(/\//g, "\\/") }),
};
