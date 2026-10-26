// Redaction for logs. Two layers: any value under a key that looks like a
// secret is replaced, and any resolved secret value that still appears in a
// line of output is scrubbed.

export const REDACTED = "[REDACTED]";

const SECRET_KEY =
  /secret|token|passw|credential|authoriz|cookie|session|signing|signature|private|api[-_]?key|client[-_]?id|key$/iu;

/** Whether a property name looks like it holds a secret. Over-redacts on purpose. */
export function looksLikeSecretKey(key: string): boolean {
  return SECRET_KEY.test(key);
}

const MAX_DEPTH = 8;

/** A copy of `value` with the contents of secret-looking keys replaced. Handles cycles and depth. */
export function redactObject(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  if (depth >= MAX_DEPTH) return "[Truncated]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactObject(item, depth + 1, seen));
  if (value instanceof Error) {
    return {
      type: value.name,
      message: value.message,
      stack: value.stack,
      ...(redactObject(Object.fromEntries(Object.entries(value)), depth + 1, seen) as object),
    };
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = looksLikeSecretKey(key) ? REDACTED : redactObject(child, depth + 1, seen);
  }
  return out;
}

/** Secrets shorter than this are not scrubbed by value: they would mangle ordinary text. */
const MIN_SCRUB_LENGTH = 4;

/** Replaces every occurrence of the given secret values in `text`. */
export function createScrubber(secretValues: readonly string[]): (text: string) => string {
  const needles = [...new Set(secretValues)]
    .filter((v) => v.length >= MIN_SCRUB_LENGTH)
    // JSON escapes: a value with quotes or backslashes is also looked for as it appears inside a JSON string.
    .flatMap((v) => [v, JSON.stringify(v).slice(1, -1)])
    .sort((a, b) => b.length - a.length);
  const unique = [...new Set(needles)];
  return (text) => unique.reduce((acc, needle) => acc.split(needle).join(REDACTED), text);
}
