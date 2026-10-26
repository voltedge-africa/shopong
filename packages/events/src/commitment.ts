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

/** The plain sentences a person sees (matrix: commit an ID, short secret). */
export const SECRET_TOO_SHORT_MESSAGE = "This community's secret is too short.";
export const PHONE_NUMBER_MESSAGE = "That doesn't look like a phone number.";
export const ID_NUMBER_MESSAGE = "That doesn't look like an ID number.";

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
    throw new RangeError(SECRET_TOO_SHORT_MESSAGE);
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

// Separators a person types into a 13-digit ID number: spaces and hyphens only (a phone number also takes
// brackets and dots, see SEPARATORS above).
const ID_SEPARATORS = /[\s-]/g;

/** The Luhn check over a string of ASCII digits: the rule that gives a South African ID its 13th digit. */
export function isLuhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/**
 * Normalise a South African ID number to its 13 digits. Spaces and hyphens are ignored. Only the check
 * digit is checked: the birth date, the citizenship digit and the 8/9 digit are not (shortcut S-2.7-2).
 * Non-ASCII digits are refused.
 */
export function normaliseIdNumber(input: string): string {
  const digits = input.trim().replace(ID_SEPARATORS, "");
  if (!/^[0-9]{13}$/.test(digits) || !isLuhnValid(digits)) {
    throw new NormalisationError(ID_NUMBER_MESSAGE);
  }
  return digits;
}

/** Commit to an ID number: normalise to its 13 digits, then HMAC-SHA512 with the community's secret. */
export async function commitIdNumber(
  communitySecret: Uint8Array,
  idNumber: string,
  hmac: HmacSha512,
): Promise<Commitment> {
  return keyedCommitment(communitySecret, normaliseIdNumber(idNumber), hmac);
}

export type PersonalKind = "phone" | "id-number";

export type PersonalCommitment =
  | { readonly ok: true; readonly commitment: Commitment }
  | {
      readonly ok: false;
      readonly problem: "not_recognised" | "secret_too_short";
      /** The plain sentence to show. */
      readonly message: string;
    };

/**
 * Normalise and commit a raw personal value, returning a result rather than throwing, so the Node's
 * `Commitments` adapter can map it to a port error. The secret is used here and nowhere else.
 */
export async function commitPersonal(
  communitySecret: Uint8Array,
  kind: PersonalKind,
  raw: string,
  hmac: HmacSha512,
): Promise<PersonalCommitment> {
  if (communitySecret.length < MIN_COMMUNITY_SECRET_BYTES) {
    return { ok: false, problem: "secret_too_short", message: SECRET_TOO_SHORT_MESSAGE };
  }
  let normalised: string;
  try {
    normalised = kind === "phone" ? normalisePhoneNumber(raw) : normaliseIdNumber(raw);
  } catch (error) {
    if (!(error instanceof NormalisationError)) throw error;
    return {
      ok: false,
      problem: "not_recognised",
      message: kind === "phone" ? PHONE_NUMBER_MESSAGE : ID_NUMBER_MESSAGE,
    };
  }
  return { ok: true, commitment: await keyedCommitment(communitySecret, normalised, hmac) };
}

/** The longest address the Node will commit to (characters, after tidying). */
export const MAX_ADDRESS_LENGTH = 200;

/**
 * Tidy an address for committing: NFKC, one space between words, trimmed, lower case. Two people typing the same
 * address get the same commitment; a different address does not. Throws `NormalisationError` when nothing is left.
 */
export function normaliseAddress(input: string): string {
  const tidy = input.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
  if (tidy === "") throw new NormalisationError("an address is needed");
  if (tidy.length > MAX_ADDRESS_LENGTH) throw new NormalisationError("the address is too long");
  return tidy;
}

/**
 * Commit to a place's exact address (AGENTS.md rule 6, story 7.4). The address is normalised first, then committed
 * with the community's secret, so the record holds the commitment and never the address.
 */
export async function commitAddress(
  communitySecret: Uint8Array,
  rawAddress: string,
  hmac: HmacSha512,
): Promise<Commitment> {
  return keyedCommitment(communitySecret, normaliseAddress(rawAddress), hmac);
}
