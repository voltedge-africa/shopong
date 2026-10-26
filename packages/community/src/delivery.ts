// Route planning in the record (story 7.4). `place.registered` gives a place an opaque id, a label, a coarse area and
// a keyed commitment of its exact address (AGENTS rule 6); the coordinates stay on the Node. `delivery.planned` names
// the order's route by place ids and the route fingerprint. `apply` judges both at log time (story 3.6): the planner
// is the treasurer, or a driver whose role stands at that time.
//
// View keys: `places/<id>` { label, area, addressCommitment }, `delivery/<order>` { event, driver, origin, destination,
// costing, distanceMeters, durationSeconds, tileRelease, fingerprint, plannedBy }.

import type { JsonObject, JsonValue } from "@shopong/events";
import { type EpochMs, type ViewReader } from "@shopong/ports";
import { isTreasurer } from "./quotes.js";
import {
  coTreasurerProblem,
  isRoleStanding,
  roleProblemOf,
  type StandingContext,
} from "./roles.js";

/** A driver is named by a standing driver role: recorded, not ended, not taken back, every grant verifying. */
export async function driverStands(
  ctx: StandingContext,
  view: ViewReader,
  who: string,
  at: EpochMs,
): Promise<boolean> {
  return isRoleStanding(ctx, view, who, "driver", at);
}

/** The plain sentences a refused place or route is shown with. */
export const DELIVERY_MESSAGES = {
  unreadable: "This route can't be read.",
  not_permitted: "Only the treasurer or the driver can plan a route.",
  unknown_place: "That place is not registered with this community.",
  same_place: "A route needs two different places.",
  not_member: "The driver is not a member of this community.",
  place_not_permitted: "Only the treasurer can add a place.",
  place_unreadable: "This place can't be read.",
  place_exists: "That place is already registered.",
  not_a_driver: "That person is not a driver of this community at this time.",
  confirm_unreadable: "This delivery can't be read.",
  confirm_not_permitted: "Only a driver can confirm a delivery.",
} as const;

export const placeKey = (place: string) => `places/${place}`;
export const deliveryKey = (order: string) => `delivery/${encodeURIComponent(order)}`;

/**
 * Who may plan a route at `at`: the treasurer (the creator or a co-treasurer), or a driver whose role stands. Otherwise
 * the plain reason: an ended driver role says so, anyone else gets the sentence for a plain member.
 */
export async function plannerProblem(
  ctx: StandingContext,
  view: ViewReader,
  who: string,
  at: EpochMs,
): Promise<string | undefined> {
  if (await isTreasurer(ctx, view, who, at)) return undefined;
  if (await isRoleStanding(ctx, view, who, "driver", at)) return undefined;
  return (
    (await coTreasurerProblem(ctx, view, who, at)) ??
    (await roleProblemOf(ctx, view, who, "driver", at)) ??
    DELIVERY_MESSAGES.not_permitted
  );
}

/** Whether `place` is registered in the view. */
export async function placeRegistered(view: ViewReader, place: string): Promise<boolean> {
  return (await view.get(placeKey(place))) !== undefined;
}

/** A place's record entry as it is stored: the label, the area and the address commitment. */
export function placeJson(fields: {
  readonly label: string;
  readonly area: string;
  readonly addressCommitment: string;
}): JsonObject {
  return {
    label: fields.label,
    area: fields.area,
    addressCommitment: fields.addressCommitment,
  };
}

/** The treasurer may add places; the same standing as quotes. */
export async function placeAdderProblem(
  ctx: StandingContext,
  view: ViewReader,
  who: string,
  at: EpochMs,
): Promise<string | undefined> {
  if (await isTreasurer(ctx, view, who, at)) return undefined;
  return (await coTreasurerProblem(ctx, view, who, at)) ?? DELIVERY_MESSAGES.place_not_permitted;
}

/** One planned delivery as the view holds it (story 8.6): the order's driver, its two places and the route's duration. */
export interface PlannedDelivery {
  readonly order: string;
  readonly driver: string;
  readonly origin: string;
  readonly destination: string;
  /** The Node's route duration, in whole seconds. The arrival estimate is the planned start plus this. */
  readonly durationSeconds: number;
  /** The planned start, in milliseconds since the epoch, when the planner gave one. */
  readonly windowStart?: number;
  /** The route's fingerprint: the Node finds the line by it (story 7.4). */
  readonly fingerprint: string;
}

const textField = (value: JsonValue | undefined, key: string): string | undefined => {
  const found = (value as { readonly [key: string]: JsonValue } | undefined)?.[key];
  return typeof found === "string" ? found : undefined;
};

/** Every planned delivery in these view rows, one per order, in view-key order. A row that is not a plan is left out. */
export function deliveriesOf(
  rows: readonly { readonly key: string; readonly value: JsonValue }[],
): readonly PlannedDelivery[] {
  const out: PlannedDelivery[] = [];
  for (const row of rows) {
    if (!row.key.startsWith("delivery/")) continue;
    const order = decodeURIComponent(row.key.slice("delivery/".length));
    const driver = textField(row.value, "driver");
    const origin = textField(row.value, "origin");
    const destination = textField(row.value, "destination");
    const value = row.value as { readonly [key: string]: JsonValue };
    if (driver === undefined || origin === undefined || destination === undefined) continue;
    if (typeof value.durationSeconds !== "number") continue;
    const fingerprint = textField(row.value, "fingerprint");
    if (fingerprint === undefined) continue;
    const windowStart = typeof value.windowStart === "number" ? value.windowStart : undefined;
    out.push({
      order,
      driver,
      origin,
      destination,
      durationSeconds: value.durationSeconds,
      fingerprint,
      ...(windowStart === undefined ? {} : { windowStart }),
    });
  }
  return out;
}
