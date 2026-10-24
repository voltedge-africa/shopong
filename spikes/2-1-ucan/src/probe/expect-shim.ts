// The few `expect` matchers the CapabilityAuth contract uses, for running the contract
// cases by hand outside vitest (inside a Metro bundle on Hermes or in a browser). Bundlers
// alias `vite-plus/test` to this file.
function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  return (
    ka.length === kb.length &&
    ka.every((k) => equal((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  );
}

function matches(actual: unknown, expected: unknown): boolean {
  if (typeof expected !== "object" || expected === null) return equal(actual, expected);
  if (typeof actual !== "object" || actual === null) return false;
  return Object.entries(expected).every(([k, v]) =>
    matches((actual as Record<string, unknown>)[k], v),
  );
}

function show(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function matchers(actual: unknown, negate: boolean) {
  const check = (pass: boolean, what: string) => {
    if (pass === negate) throw new Error(`expected ${show(actual)} ${negate ? "not " : ""}${what}`);
  };
  return {
    toBe: (e: unknown) => check(Object.is(actual, e), `to be ${show(e)}`),
    toEqual: (e: unknown) => check(equal(actual, e), `to equal ${show(e)}`),
    toMatchObject: (e: unknown) => check(matches(actual, e), `to match ${show(e)}`),
    toMatch: (e: RegExp) => check(e.test(String(actual)), `to match ${String(e)}`),
    toContain: (e: unknown) =>
      check(Array.isArray(actual) ? actual.includes(e) : String(actual).includes(String(e)), `to contain ${show(e)}`),
    toHaveLength: (n: number) => check((actual as { length: number }).length === n, `to have length ${n}`),
    toBeLessThan: (n: number) => check((actual as number) < n, `to be less than ${n}`),
  };
}

export function expect(actual: unknown) {
  return { ...matchers(actual, false), not: matchers(actual, true) };
}

const unsupported = () => {
  throw new Error("describe/it are not available outside vitest; run cases by hand");
};
export const describe = unsupported;
export const it = unsupported;
