// Route planning in the record (story 7.4). `place.registered` gives a place an opaque id, a label, a coarse area and
// a keyed commitment of its exact address (AGENTS rule 6); the coordinates stay on the Node. `delivery.planned` names
// the order's route by place ids and the route fingerprint. `apply` judges both at log time (story 3.6): the planner
// is the treasurer, or a driver whose role stands at that time.
//
// View keys: `places/<id>` { label, area, addressCommitment }, `delivery/<order>` { event, driver, origin, destination,
// costing, distanceMeters, durationSeconds, tileRelease, fingerprint, plannedBy }.

import type { JsonObject } from "@shopong/events";
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
