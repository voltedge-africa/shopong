// Proof of delivery and of collection (story 7.6). The assigned driver confirms the arrival (`delivery.confirmed`), each
// member confirms their own share (`collection.confirmed`), and anyone in the order may dispute it (`delivery.disputed`).
// `apply` judges every one at log time (story 3.6); a confirmation is never edited, and a dispute is a later event beside
// it. This file holds the plain sentences, the view keys and the progress an order shows; `apply` makes the checks.
//
// View keys: `delivered/<order>` { event, driver, photoSha512, claimedAt, lat?, lng?, place? }, `collected/<order>/<member>`
// { event, delivery, claimedAt }, `disputes/<order>/<event id>` { event, by, note?, claimedAt }. The order's members are the
// pledges (`pledges/<order>/<member>`, pledges.ts).

import type { ViewReader } from "@shopong/ports";
import { deliveryKey } from "./delivery.js";
import { pledgeKey } from "./pledges.js";

/** The plain sentences a refused confirmation or dispute is shown with. */
export const PROOF_MESSAGES = {
  unreadable: "This can't be recorded: its details are not in the form the record expects.",
  not_assigned: "Only the assigned driver can confirm this delivery.",
  no_delivery: "No delivery is planned for this order yet.",
  already_delivered: "Already confirmed.",
  not_delivered: "This order has not been delivered yet.",
  wrong_delivery: "That is not this order's delivery.",
  not_in_order: "You are not in this order.",
  collect_not_member: "Only a member can confirm their own collection.",
  already_collected: "Already confirmed.",
  dispute_not_member: "Only a member can raise a dispute.",
} as const;

export const deliveredKey = (order: string) => `delivered/${encodeURIComponent(order)}`;
export const collectedKey = (order: string, member: string) =>
  `collected/${encodeURIComponent(order)}/${member}`;
export const disputeKey = (order: string, eventId: string) =>
  `disputes/${encodeURIComponent(order)}/${eventId}`;

/** What the record holds once the assigned driver's arrival is confirmed. Coordinates only when they were given. */
export interface DeliveryRecord {
  /** The event id of the `delivery.confirmed`. A collection and a dispute name it. */
  readonly event: string;
  readonly driver: string;
  readonly photoSha512: string;
  /** The time the driver's phone gave the confirmation. */
  readonly claimedAt: number;
  /** The coarse place: decimal strings of two decimal places at most (about 1 km), as the driver's phone rounded it. */
  readonly lat?: string;
  readonly lng?: string;
  readonly place?: string;
}

/** One dispute as the order shows it, beside the confirmation. */
export interface DisputeRecord {
  readonly event: string;
  readonly by: string;
  readonly note?: string;
}

/** One member's share of an order: whether they have confirmed their collection. */
export interface ShareRecord {
  readonly member: string;
  readonly collected: boolean;
}

/** An order's proof as the view holds it: whether it arrived, the shares and how many are collected, and disputes. */
export interface OrderProgress {
  readonly arrived: boolean;
  /** The driver the route names, once one is planned. */
  readonly plannedDriver?: string;
  readonly delivered?: DeliveryRecord;
  /** Every member with a share in the order (a pledge), and whether each has collected it. */
  readonly shares: readonly ShareRecord[];
  /** Members with a confirmed collection. */
  readonly collected: number;
  /** Members with a share in the order (a pledge). */
  readonly of: number;
  readonly disputes: readonly DisputeRecord[];
}

function fieldOf(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as { readonly [key: string]: unknown })[key]
    : undefined;
}

const textOf = (value: unknown, key: string): string | undefined => {
  const found = fieldOf(value, key);
  return typeof found === "string" ? found : undefined;
};

const numberOf = (value: unknown, key: string): number | undefined => {
  const found = fieldOf(value, key);
  return typeof found === "number" ? found : undefined;
};

/** The driver the route names for an order, or undefined when nothing is planned for it. */
export async function plannedDriverOf(
  view: ViewReader,
  order: string,
): Promise<string | undefined> {
  return textOf(await view.get(deliveryKey(order)), "driver");
}

/** The delivery the record holds for an order: its confirmation, as `apply` wrote it. */
export async function deliveredOf(
  view: ViewReader,
  order: string,
): Promise<DeliveryRecord | undefined> {
  const value = await view.get(deliveredKey(order));
  const event = textOf(value, "event");
  const driver = textOf(value, "driver");
  const photoSha512 = textOf(value, "photoSha512");
  const claimedAt = numberOf(value, "claimedAt");
  if (event === undefined || driver === undefined || photoSha512 === undefined) return undefined;
  if (claimedAt === undefined) return undefined;
  const lat = textOf(value, "lat");
  const lng = textOf(value, "lng");
  const place = textOf(value, "place");
  return {
    event,
    driver,
    photoSha512,
    claimedAt,
    ...(lat === undefined || lng === undefined ? {} : { lat, lng }),
    ...(place === undefined ? {} : { place }),
  };
}

/** The order's progress: arrived, the shares and how many are collected, and its disputes. Pure over the view. */
export async function progressOf(view: ViewReader, order: string): Promise<OrderProgress> {
  const delivered = await deliveredOf(view, order);
  const plannedDriver = await plannedDriverOf(view, order);
  const prefix = `pledges/${encodeURIComponent(order)}/`;
  const shares: ShareRecord[] = [];
  for (const row of await view.list(prefix)) {
    const member = row.key.slice(prefix.length);
    const collected = (await view.get(collectedKey(order, member))) !== undefined;
    shares.push({ member, collected });
  }
  const disputes: DisputeRecord[] = [];
  for (const row of await view.list(`disputes/${encodeURIComponent(order)}/`)) {
    const event = textOf(row.value, "event");
    const by = textOf(row.value, "by");
    if (event === undefined || by === undefined) continue;
    const note = textOf(row.value, "note");
    disputes.push({ event, by, ...(note === undefined ? {} : { note }) });
  }
  return {
    arrived: delivered !== undefined,
    ...(plannedDriver === undefined ? {} : { plannedDriver }),
    ...(delivered === undefined ? {} : { delivered }),
    shares,
    collected: shares.filter((share) => share.collected).length,
    of: shares.length,
    disputes,
  };
}

/** Whether `who` has a share in `order` (a pledge), as the view holds it. */
export async function hasShareIn(view: ViewReader, order: string, who: string): Promise<boolean> {
  return (await view.get(pledgeKey(order, who))) !== undefined;
}
