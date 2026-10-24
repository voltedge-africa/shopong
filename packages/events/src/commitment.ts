// Keyed commitments to personal data (AD-9, AGENTS.md rule 6). The shared record
// holds HMAC-SHA512(communitySecret, normalised value), never the value.
//
// This package defines only the interface and the normalisation rules. The
// HMAC itself comes from an audited library injected by story 2.7, because
// expo-crypto has no HMAC.

import { toHex } from "./hash.js";
import { encodeUtf8 } from "./utf8.js";

/** HMAC-SHA512(key, message), returning 64 bytes. */
export type HmacSha512 = (key: Uint8Array, message: Uint8Array) => Promise<Uint8Array>;

/** Lowercase hex HMAC-SHA512 (128 characters). */
export type Commitment = string & { readonly __brand: "Commitment" };

export const MIN_COMMUNITY_SECRET_BYTES = 32;

const HMAC_HEX = /^[0-9a-f]{128}$/;

export function isCommitment(value: unknown): value is Commitment {
  return typeof value === "string" && HMAC_HEX.test(value);
}

/**
 * Commit to an already-normalised value: HMAC-SHA512 over its UTF-8 bytes.
 * Callers must normalise first (for example with `normalisePhoneNumber`), or
 * the same person yields different commitments.
 */
export async function keyedCommitment(
  communitySecret: Uint8Array,
  normalisedValue: string,
  hmac: HmacSha512,
): Promise<Commitment> {
  if (communitySecret.length < MIN_COMMUNITY_SECRET_BYTES) {
    throw new RangeError(`community secret must be at least ${MIN_COMMUNITY_SECRET_BYTES} bytes`);
  }
  if (normalisedValue.length === 0) throw new RangeError("cannot commit to an empty value");
  const mac = await hmac(communitySecret, encodeUtf8(normalisedValue));
  if (mac.length !== 64)
    throw new Error(`injected HmacSha512 returned ${mac.length} bytes, expected 64`);
  return toHex(mac) as Commitment;
}

/** Normalise a phone number, then commit to it. */
export async function commitPhoneNumber(
  communitySecret: Uint8Array,
  phoneNumber: string,
  hmac: HmacSha512,
): Promise<Commitment> {
  return keyedCommitment(communitySecret, normalisePhoneNumber(phoneNumber), hmac);
}

export class NormalisationError extends Error {
  override name = "NormalisationError";
}

// Separators people type or paste: whitespace (including NBSP and narrow NBSP),
// hyphens and dashes, dots, slashes, parentheses, and the invisible direction
// marks phone contact apps insert.
const SEPARATORS =
  /[\s\-./()\u2010-\u2015\u2212\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g;

/**
 * Normalise a phone number to E.164 (`+` and digits only), defaulting to South Africa.
 *
 * South African forms (country code 27, national significant number of 9 digits
 * not starting with 0):
 *   `082 123 4567`, `0821234567`, `+27 82 123 4567`, `+27 (0)82 123 4567`,
 *   `27821234567`, `0027821234567`  ->  `+27821234567`
 *
 * Other countries: only the international form (`+CC...` or `00CC...`) is
 * accepted, 8 to 15 digits, with no trunk-prefix guessing (`(0)` is rejected).
 * Anything else, including letters, extensions and 9-digit numbers without a
 * trunk 0, throws NormalisationError rather than guessing.
 */
export function normalisePhoneNumber(input: string): string {
  const trimmed = input.trim();
  const hadTrunkZero = /\(\s*0\s*\)/.test(trimmed);
  const compact = trimmed.replace(/\(\s*0\s*\)/g, "").replace(SEPARATORS, "");

  let international: string;
  if (/^\+[0-9]+$/.test(compact)) international = compact.slice(1);
  else if (/^00[0-9]+$/.test(compact)) international = compact.slice(2);
  else if (/^27[0-9]{9}$/.test(compact)) international = compact;
  else if (/^0[0-9]{9}$/.test(compact) && !hadTrunkZero) international = `27${compact.slice(1)}`;
  else throw new NormalisationError("not a recognisable phone number");

  if (international.startsWith("27")) {
    let national = international.slice(2);
    // `+27 082 ...` and `+27 (0)82 ...`: drop the redundant trunk 0.
    if (/^0[0-9]{9}$/.test(national)) national = national.slice(1);
    if (!/^[1-9][0-9]{8}$/.test(national)) {
      throw new NormalisationError(
        "a South African number has 9 digits after +27, not starting with 0",
      );
    }
    return `+27${national}`;
  }
  if (hadTrunkZero)
    throw new NormalisationError("(0) trunk prefix is only understood for South African numbers");
  if (!/^[1-9][0-9]{7,14}$/.test(international)) {
    throw new NormalisationError(
      "an international number has 8 to 15 digits and does not start with 0",
    );
  }
  return `+${international}`;
}
