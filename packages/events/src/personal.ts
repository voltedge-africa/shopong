// The personal-data guard (AGENTS.md rule 6, shortcut S-2.7-3). The shared record is append-only, so a raw
// phone or ID number written to it can never be taken back. `checkPersonalFields` is pure. The community
// service checks before it appends (`assertNoPersonalData`), and `apply` checks again as the second line.
//
// Two rules. By field name: a field whose name says phone, mobile, ID number, address or street must hold a
// commitment (or null), and so must any field ending in "Commitment". By shape in any string: after the text
// is normalised (NFKC, every Unicode decimal digit mapped to ASCII, separators and zero-width characters
// removed, ISO dates and 8-digit dates taken out), seven or more digits is a phone number and a 13-digit run
// that passes the ID check digit is an ID number. Commitments, real-looking DIDs, the invitation token id and
// 64- or 128-character hex ids are exempt, each only in its exact shape and as a whole value.
// This is a heuristic: it catches mistakes, not deliberate hiding (shortcuts S-2.7-3, S-2.7-11 to S-2.7-13).

import { isCommitment, isLuhnValid } from "./commitment.js";
import { isPlainObject, type JsonValue } from "./json.js";
import type { Issue } from "./registry.js";

/** The plain sentence a person sees when an event is refused for personal data. */
export const PERSONAL_DATA_MESSAGE = "Personal details can't be written to the shared record.";

export interface PersonalCheckOptions {
  /** Whether free text is checked by shape. Field names are always checked. */
  readonly freeText?: boolean;
}

/** The words a key name splits into: `homeAddress`, `home_address` and `HOME-ADDRESS` all give home, address. */
function nameWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "");
}

/** A single word that names personal data wherever it appears in a field name. */
const PERSONAL_WORDS = new Set([
  "phone",
  "phones",
  "telephone",
  "tel",
  "mobile",
  "msisdn",
  "cell",
  "whatsapp",
  "contact",
  "street",
  "idno",
  "idnum",
  "idnumber",
]);
/** Two words in a row that name personal data. */
const PERSONAL_PAIRS: readonly (readonly [string, string])[] = [
  ["id", "no"],
  ["id", "num"],
  ["id", "number"],
  ["national", "id"],
  ["identity", "number"],
  ["cell", "number"],
];
/** Words that, before `address`, make it an electronic address rather than a home address. */
const NOT_A_HOME_ADDRESS = new Set(["ip", "mac", "email", "mail", "url", "web", "memory", "e"]);

function isPersonalName(words: readonly string[]): boolean {
  if (words.some((w) => PERSONAL_WORDS.has(w))) return true;
  const pairFound = PERSONAL_PAIRS.some(([a, b]) =>
    words.some((word, j) => word === a && words[j + 1] === b),
  );
  if (pairFound) return true;
  return words.some((w, i) => {
    if (w !== "address") return false;
    const before = words[i - 1];
    return before === undefined || !NOT_A_HOME_ADDRESS.has(before);
  });
}

/** Unicode decimal digits (`\p{Nd}`): each block is ten digits in order, so the value is the offset from its first digit. */
const DECIMAL = /^\p{Nd}$/u;
function digitValue(codePoint: number): number {
  let start = codePoint;
  while (start > 0 && DECIMAL.test(String.fromCodePoint(start - 1))) start -= 1;
  return (codePoint - start) % 10;
}

/** NFKC, then every Unicode decimal digit as its ASCII digit. */
export function normaliseDigits(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\p{Nd}/gu, (ch) => String(digitValue(ch.codePointAt(0) ?? 0)));
}

/** Separators people type or paste, including zero-width characters, which are removed rather than replaced. */
const SHAPE_SEPARATORS = /[\s+\-­‐-―−./\\()[\]{},_​-‏‪-‮⁠⁦-⁩﻿]/g;
const ISO_DATE = /(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)/g;
const EIGHT_DIGIT_DATE = /(?<!\d)(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])(?!\d)/g;

/** The digits of `text` as they are compared with a phone or ID number: normalised, dates taken out, separators gone. */
export function shapeOf(text: string): string {
  return normaliseDigits(text)
    .replace(ISO_DATE, " ")
    .replace(EIGHT_DIGIT_DATE, " ")
    .replace(SHAPE_SEPARATORS, "");
}

/** Seven or more digits once the text is normalised: a phone number. */
export const hasPhoneNumberShape = (text: string): boolean => /\d{7}/.test(shapeOf(text));

/** A run of 13 digits that passes the ID check digit, once the text is normalised. */
export const hasIdNumberShape = (text: string): boolean =>
  [...shapeOf(text).matchAll(/\d{13}/g)].some((m) => isLuhnValid(m[0]));

/** A DID as `did:key` writes it: `z`, then base58 (no 0, O, I or l), at least 40 characters. Whole value only. */
const DID_KEY = /^did:key:z[1-9A-HJ-NP-Za-km-z]{40,}$/;
/**
 * A 64-character lowercase hex id (a space key or similar), or a 128-character one (an event id: SHA-512 hex, story 4.3).
 * Whole value only, so a hex id is never read as digits; a phone or ID number is never 64 or 128 hex characters.
 */
const HEX_64 = /^(?:[0-9a-f]{64}|[0-9a-f]{128})$/;
/** The shape of an invitation token id: a CIDv1, DAG-CBOR and SHA-256, base32 lower-case (59 characters). */
const INVITATION_ID = /^bafyrei[a-z2-7]{52}$/;

/** Returns one issue per personal value found, with where it is in the payload. Empty when it is clean. */
export function checkPersonalFields(
  payload: unknown,
  options: PersonalCheckOptions = {},
): readonly Issue[] {
  const freeText = options.freeText ?? true;
  const issues: Issue[] = [];

  const leaf = (value: JsonValue | undefined, path: string, key: string | undefined) => {
    if (value === null || value === undefined) return;
    const words = key === undefined ? [] : nameWords(key);
    if (words.at(-1) === "commitment" || (key !== undefined && isPersonalName(words))) {
      if (!isCommitment(value)) issues.push({ path, message: PERSONAL_DATA_MESSAGE });
      return;
    }
    if (!freeText || typeof value !== "string") return;
    if (key === "invitation" && INVITATION_ID.test(value)) return;
    if (isCommitment(value) || DID_KEY.test(value) || HEX_64.test(value)) return;
    if (hasPhoneNumberShape(value) || hasIdNumberShape(value)) {
      issues.push({ path, message: PERSONAL_DATA_MESSAGE });
    }
  };

  const walk = (value: unknown, path: string, key: string | undefined): void => {
    if (Array.isArray(value)) {
      value.forEach((item: unknown, index) => walk(item, `${path}[${index}]`, key));
      return;
    }
    if (isPlainObject(value)) {
      for (const [name, child] of Object.entries(value)) {
        walk(child, `${path}.${name}`, name);
      }
      return;
    }
    leaf(value as JsonValue, path, key);
  };

  walk(payload, "$.payload", undefined);
  return issues;
}

/** Thrown by `assertNoPersonalData`. The message is the plain sentence; `issues` says where. */
export class PersonalDataError extends Error {
  override name = "PersonalDataError";
  readonly issues: readonly Issue[];

  constructor(issues: readonly Issue[]) {
    super(PERSONAL_DATA_MESSAGE);
    this.issues = issues;
  }
}

/**
 * Throws `PersonalDataError` if the payload holds a raw personal value. Every writer calls this before it
 * appends (the community service, and the Node's sync route when it exists), so nothing reaches the log.
 */
export function assertNoPersonalData(payload: unknown, options: PersonalCheckOptions = {}): void {
  const issues = checkPersonalFields(payload, options);
  if (issues.length > 0) throw new PersonalDataError(issues);
}

const STREET_WORDS =
  "street|st|road|rd|avenue|ave|drive|dr|lane|ln|crescent|cres|close|way|court|ct|boulevard|blvd|highway|section|ext|extension|unit|flat|erf|stand|house";
/** A number, then a street word within 40 characters. */
const NUMBER_THEN_STREET = new RegExp(`\\b\\d+\\b[\\s\\S]{0,40}?\\b(?:${STREET_WORDS})\\b`, "i");
/** An erf, stand, unit, flat or house with its number. */
const DESIGNATED_NUMBER = /\b(?:erf|stand|unit|flat|house)\s*(?:no\.?|number|#)?\s*\d+/i;

/**
 * True when the text reads as a street address: a street number followed by a street word, or an erf, stand, unit,
 * flat or house number. Place names are names, never addresses (the product owner's rule). Digits are normalised
 * first, so Unicode digits count. Story 3.7 adds the same-named function for the community's own text.
 */
export function looksLikeAddress(text: string): boolean {
  const normalised = normaliseDigits(text).normalize("NFKC");
  return NUMBER_THEN_STREET.test(normalised) || DESIGNATED_NUMBER.test(normalised);
}
