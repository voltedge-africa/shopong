// The treasurer's Places screen and the member's area (story 7.3). The phone checks the form in plain words before it
// sends anything, applies the same coarsening rule the record applies to a member's area, and counts the demand by area.
// The exact point and the address leave the phone once, to the Node, which keeps them; the record never sees them.
import { coarseArea, looksLikeAddress } from "@shopong/events";
import type { NodePlaceRegistration } from "./nodeClient";

/** What the treasurer types on the Places screen. Every field is text, as the screen holds it. */
export interface PlaceForm {
  readonly label: string;
  readonly area: string;
  readonly lat: string;
  readonly lng: string;
  readonly address: string;
}

/** The plain sentences the Places screen shows for a form it will not send. */
export const PLACE_FORM_MESSAGES = {
  missing: "Fill in the name, the suburb or town, the latitude and longitude, and the address.",
  named: "A place is named, never addressed.",
  point: "The latitude is between -90 and 90, and the longitude between -180 and 180.",
  address: "Send an address of up to 200 characters.",
} as const;

const isBlank = (text: string) => text.trim() === "";

/** The Node's body for a valid form: the phone's registration key, and the fields as numbers and trimmed text. */
export function placeBodyOf(form: PlaceForm, request: string): NodePlaceRegistration {
  return {
    request,
    label: form.label.trim(),
    area: form.area.trim(),
    lat: Number(form.lat),
    lng: Number(form.lng),
    address: form.address.trim(),
  };
}

/**
 * Checks the form in the order the treasurer reads it: every field filled, a name that is not an address, a suburb or
 * town (`coarseArea`), a point on the map, and an address of up to 200 characters. Returns the body to send, or the
 * one plain sentence for the first thing wrong.
 */
export function placeFormProblem(
  form: PlaceForm,
  request: string,
):
  | { readonly ok: true; readonly body: NodePlaceRegistration }
  | { readonly ok: false; readonly message: string } {
  if ([form.label, form.area, form.lat, form.lng, form.address].some(isBlank)) {
    return { ok: false, message: PLACE_FORM_MESSAGES.missing };
  }
  if (looksLikeAddress(form.label)) return { ok: false, message: PLACE_FORM_MESSAGES.named };
  const area = coarseArea(form.area);
  if (!area.ok) return { ok: false, message: area.reason };
  const lat = Number(form.lat);
  const lng = Number(form.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { ok: false, message: PLACE_FORM_MESSAGES.point };
  }
  if (form.address.trim().length > 200) return { ok: false, message: PLACE_FORM_MESSAGES.address };
  return { ok: true, body: placeBodyOf(form, request) };
}

/** The suburbs and towns the community's collection points are in, once each, in order: the member's picker. */
export function placeChoicesOf<T extends { readonly area: string }>(
  places: readonly T[],
): string[] {
  return [...new Set(places.map((place) => place.area).filter((area) => area !== ""))].sort();
}

/** How many members are in each area, most first. A member who gave no area is not counted. */
export function areaDemandOf(
  members: readonly { readonly did: string; readonly area: string }[],
): { area: string; members: number }[] {
  const counts = new Map<string, number>();
  for (const member of members) {
    if (member.area !== "") counts.set(member.area, (counts.get(member.area) ?? 0) + 1);
  }
  return [...counts]
    .map(([area, count]) => ({ area, members: count }))
    .sort((a, b) => b.members - a.members || a.area.localeCompare(b.area));
}

/**
 * Which sections of the Places card a member sees (product owner, story 7.3). The collection points, the members' areas
 * and the demand by area are visible to every member, and each member sets their own area. Only the form that registers
 * a collection point is for the treasurer (and a co-treasurer), who is the one that can register it.
 */
export function placesCardSectionsOf(canAddPlaces: boolean): {
  readonly collectionPoints: true;
  readonly demandByArea: true;
  readonly yourArea: true;
  readonly registerForm: boolean;
} {
  return { collectionPoints: true, demandByArea: true, yourArea: true, registerForm: canAddPlaces };
}
