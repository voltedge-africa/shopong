// CSP-safe replacement for apache-arrow@17 `builder/valid.mjs`.
// Upstream compiles an `isValid` function with `new Function(...)`, which needs 'unsafe-eval'.
// This version is a closure over a Set: same semantics (NaN handled separately), no eval.
export function createIsValidFunction(nullValues) {
  if (!nullValues || nullValues.length <= 0)
    return function isValid() {
      return true;
    };
  const noNaNs = new Set(nullValues.filter((x) => x === x));
  const hasNaN = nullValues.length !== nullValues.filter((x) => x === x).length;
  return function isValid(x) {
    if (hasNaN && x !== x) return false;
    return !noNaNs.has(x);
  };
}
