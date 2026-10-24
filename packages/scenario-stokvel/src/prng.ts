// Seeded randomness for the scenario. Nothing here reads Math.random or the clock.

/** 32-bit FNV-1a of a string. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a small seeded generator returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `byteCount` pseudo-random bytes as lowercase hex, a pure function of `seed` and `label`.
 * The same label always gives the same value, which is what makes re-running a step build
 * byte-identical events (same event id) instead of new ones.
 */
export function seededHex(seed: string, label: string, byteCount: number): string {
  const next = mulberry32(hashString(`${seed}|${label}`));
  let hex = "";
  for (let i = 0; i < byteCount; i++)
    hex += Math.floor(next() * 256)
      .toString(16)
      .padStart(2, "0");
  return hex;
}
