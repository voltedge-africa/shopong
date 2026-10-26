// Stitch's decimal shape for an amount, built from integer minor units with integer arithmetic only (AGENTS rule:
// money is integer minor units; decimal strings appear only at the Stitch-shaped boundary).

/**
 * The decimal string Stitch expects for a non-negative whole number of minor units (cents for ZAR): 12550 gives
 * "125.50". Undefined for anything that is not a non-negative safe integer, so a float never reaches Stitch.
 */
export function stitchAmount(minor: number): string | undefined {
  if (!Number.isSafeInteger(minor) || minor < 0) return undefined;
  const cents = minor % 100;
  // (minor - cents) is an exact multiple of 100, so the division is exact for every safe integer.
  const major = (minor - cents) / 100;
  return `${String(major)}.${String(cents).padStart(2, "0")}`;
}
