// A small retailer's business profile (story 9.1). The event is `business.profile` (registry.ts): the retailer writes
// it into a community they have joined, signed with their own DID key. The record keeps only the fields the retailer
// chose to show, plus the signature over exactly those fields and the community key. A field the retailer keeps back
// is never written, because the record cannot be edited later (AGENTS rule 6).

import { canonicalBytes } from "./canonical.js";
import { coarseArea } from "./area.js";
import { hasIdNumberShape, hasPhoneNumberShape, looksLikeAddress } from "./personal.js";

export const BUSINESS_NAME_MAX = 80;

/** The kinds of business a profile can show. A fixed list, so search (story 9.2) can filter on it. */
export const BUSINESS_KINDS = [
  "spaza shop",
  "general dealer",
  "street seller",
  "home business",
  "other",
] as const;

export type BusinessKind = (typeof BUSINESS_KINDS)[number];

/** A signature as the phone writes it: 64 bytes in base64url without padding (86 characters). */
export const PROFILE_SIGNATURE = /^[A-Za-z0-9_-]{86}$/;

/** The fields a profile can show. `name` is always shown; `kind` and `area` only when the retailer chose to show them. */
export interface BusinessProfileFields {
  readonly name: string;
  readonly kind?: string;
  readonly area?: string;
}

/** The words a person sees for a name that cannot be shown. */
export const BUSINESS_NAME_RULE = `The business name must be plain words of 1 to ${BUSINESS_NAME_MAX} characters, not an address.`;

/** A business name: plain text, bounded, and not an address, a phone number or an ID number. */
export function businessNameOk(name: string): boolean {
  const trimmed = name.trim();
  let control = false;
  for (let i = 0; i < name.length; i++) if (name.charCodeAt(i) < 0x20) control = true;
  return (
    trimmed.length >= 1 &&
    trimmed.length <= BUSINESS_NAME_MAX &&
    !control &&
    !looksLikeAddress(trimmed) &&
    !hasPhoneNumberShape(trimmed) &&
    !hasIdNumberShape(trimmed)
  );
}

/**
 * The bytes a profile signature covers: the profile's label, the community key and the shown fields in canonical JSON.
 * Changing any shown field, or moving the profile to another community, makes the signature fail.
 */
export function businessProfileBytes(space: string, fields: BusinessProfileFields): Uint8Array {
  const shown: Record<string, string> = { name: fields.name };
  if (fields.kind !== undefined) shown.kind = fields.kind;
  if (fields.area !== undefined) shown.area = fields.area;
  return canonicalBytes({ profile: "ocn-business-profile/v1", space, fields: shown });
}

/** Why a kind or area is refused, or `undefined` when it is fine. Used by the phone and by the shape check. */
export function profileKindOk(kind: string): boolean {
  return (BUSINESS_KINDS as readonly string[]).includes(kind);
}

export function profileAreaOk(area: string): boolean {
  return coarseArea(area).ok;
}
