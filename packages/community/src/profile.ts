// A small retailer's business profile in one community (story 9.1). The retailer writes `business.profile` into a
// community they have joined, signed with their own DID key. The record keeps the name, and the kind and suburb only
// when the retailer chose to show them; `apply` checks the membership, the shape and the signature. The view keeps one
// profile per member at `profiles/<did>` { name, kind?, area?, signature }, and the latest profile replaces the last.

import {
  BUSINESS_KINDS,
  BUSINESS_NAME_RULE,
  businessNameOk,
  coarseArea,
  type BusinessProfileFields,
} from "@shopong/events";
import type { Did, ViewReader } from "@shopong/ports";

export const PROFILE_TYPE = "business.profile" as const;

/** Each refusal of a profile is one plain sentence, as the phone and the record show it (story 9.1). */
export const PROFILE_MESSAGES = {
  unreadable: "This profile can't be read.",
  not_a_member: "Only a member of this community can publish a profile here.",
  bad_signature: "This profile was not signed by the person it names.",
  unknown_kind: `Choose one kind of business: ${BUSINESS_KINDS.join(", ")}.`,
  name_rule: BUSINESS_NAME_RULE,
} as const;

/** What the retailer types. Only the fields given are shown; a field left out is never written to the record. */
export interface BusinessProfileDraft {
  readonly name: string;
  readonly kind?: string;
  readonly area?: string;
}

/** One member's shown profile as the view holds it. */
export interface BusinessProfile extends BusinessProfileFields {
  readonly member: Did;
  readonly signature: string;
}

/** The view key of a member's profile. */
export const profileKey = (member: string) => `profiles/${member}`;

/**
 * The shown fields for a draft, or the plain sentence why they cannot be shown. An empty kind or area is left out, which
 * is how a retailer keeps a field back. Checked on the phone before anything is signed; `apply` checks the same again.
 */
export function profileFieldsOf(
  draft: BusinessProfileDraft,
):
  | { readonly ok: true; readonly fields: BusinessProfileFields }
  | { readonly ok: false; readonly reason: string } {
  const name = draft.name.trim();
  if (!businessNameOk(name)) return { ok: false, reason: PROFILE_MESSAGES.name_rule };
  const fields: { name: string; kind?: string; area?: string } = { name };
  const kind = draft.kind?.trim() ?? "";
  if (kind !== "") {
    if (!(BUSINESS_KINDS as readonly string[]).includes(kind)) {
      return { ok: false, reason: PROFILE_MESSAGES.unknown_kind };
    }
    fields.kind = kind;
  }
  const area = draft.area?.trim() ?? "";
  if (area !== "") {
    const coarse = coarseArea(area);
    if (!coarse.ok) return { ok: false, reason: coarse.reason };
    fields.area = coarse.area;
  }
  return { ok: true, fields };
}

/** The shown fields of a `business.profile` payload that has passed the shape check. */
export function profileFieldsOfPayload(payload: {
  readonly [key: string]: unknown;
}): BusinessProfileFields {
  const name = typeof payload.name === "string" ? payload.name : "";
  const kind = typeof payload.kind === "string" ? payload.kind : undefined;
  const area = typeof payload.area === "string" ? payload.area : undefined;
  return {
    name,
    ...(kind === undefined ? {} : { kind }),
    ...(area === undefined ? {} : { area }),
  };
}

/** Every profile in these view rows, each with its member. A row that is not a profile is left out. */
export function profilesOf(
  rows: readonly { readonly key: string; readonly value: unknown }[],
): readonly BusinessProfile[] {
  const out: BusinessProfile[] = [];
  for (const row of rows) {
    if (!row.key.startsWith("profiles/")) continue;
    const value = row.value as Partial<BusinessProfile> | undefined;
    if (value === undefined || typeof value !== "object" || value === null) continue;
    if (typeof value.name !== "string" || typeof value.signature !== "string") continue;
    const member = row.key.slice("profiles/".length) as Did;
    out.push({
      member,
      name: value.name,
      signature: value.signature,
      ...(typeof value.kind === "string" ? { kind: value.kind } : {}),
      ...(typeof value.area === "string" ? { area: value.area } : {}),
    });
  }
  return out;
}

/** The profile of one member, if they have published one. */
export async function profileOf(
  view: ViewReader,
  member: string,
): Promise<BusinessProfile | undefined> {
  const rows = await view.list(profileKey(member));
  return profilesOf(rows.filter((row) => row.key === profileKey(member)))[0];
}
