// Pledges (story 4.3): a member's pledge of an amount to an order, and the rules a payment for it must meet.
//
// A member makes a pledge as a `pledge.created` event. Its payload is `{ order, member, amount }` with the amount
// in whole rand cents (`{ currency: "ZAR", minor }`). `apply` checks it and records two view keys:
//   `pledges/<order>/<member>`      the member's latest pledge for the order (architecture: pledges/<orderId>/<did>)
//   `pledge-events/<event id>`      the same pledge by its event id, which is what a payment names
// A pledge is refused, and written nowhere, if the writer is not the member it names, the member is not a member of
// the community, the amount is outside R1.00 to R3,000.00, or the event id is already recorded (duplicate).
//
// A `payment.requested` is the Node's record of a bank request for a pledge (apply records `payments/<pledge event>`,
// with the amount only: the request's own id is a capability on the bank page, so it stays in the Node).
// A member may not write one: the record refuses a payment request from a current member, so a phone cannot make a
// payment through the record (AGENTS rule 4). Whether the writer is the Node is checked where the Node writes (the
// payments route), because `apply` does not know the Node's identity.
//
// Pure functions here are used by `apply` (the record) and the Node's payment routes. The phone's form turns typed
// rand into cents with the Orders miniapp's `parseRand`.

import type { JsonObject } from "@shopong/events";
import type { Did, ViewReader } from "@shopong/ports";

/** R1.00 and R3,000.00, in cents. R3,000.00 is the lowest pay-by-bank limit in `sandbox-setup.md` (unverified). */
export const PLEDGE_LIMITS = {
  currency: "ZAR",
  minCents: 100,
  maxCents: 300_000,
} as const;

/** The plain sentences a person sees. */
export const PLEDGE_MESSAGES = {
  too_small: "The smallest payment is R1.00.",
  too_big: "That is more than one bank allows in one payment.",
  not_zar: "Pledges are in rand.",
  amount_whole: "Write the amount in rand, like 150 or 150.50.",
  no_order: "Name the order you are pledging to.",
  not_member: "Only a member can pledge.",
  wrong_member: "A pledge must be made by the member it names.",
  duplicate: "This pledge is already recorded.",
  pay_not_yours: "You can only pay your own pledge.",
  pay_no_role: "You can't pay with this role.",
  unknown_pledge: "This pledge is not on the record.",
  amount_must_match: "The amount must match your pledge.",
  unknown_field:
    "Remove the extra field: a pledge holds only its order, its member and its amount.",
  payment_fields: "A payment request holds only its direction, its pledge and its amount.",
  not_pay_in: "Only a payment in for a pledge is recorded here.",
  node_only_payment: "Only the OCN Node can ask for a payment.",
} as const;

/** The keys a pledge holds, and the keys a payment request holds. Any other key is refused. */
export const PLEDGE_KEYS = ["order", "member", "amount"] as const;
export const PAYMENT_REQUEST_KEYS = ["direction", "pledgeEvent", "amount", "by"] as const;

/** The message a member's `payment.requested` is refused with (see the file comment). */
export const PAYMENT_TYPE_MESSAGE = PLEDGE_MESSAGES.node_only_payment;

export interface PledgeFields {
  readonly order: string;
  readonly member: Did;
  readonly minor: number;
}

export type PledgeCheck =
  | { readonly ok: true; readonly value: PledgeFields }
  | { readonly ok: false; readonly problem: string };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A limit problem for an amount in cents, or undefined when it is in range. */
export function amountProblem(minor: unknown): string | undefined {
  if (typeof minor !== "number" || !Number.isSafeInteger(minor) || minor < 0) {
    return PLEDGE_MESSAGES.amount_whole;
  }
  if (minor < PLEDGE_LIMITS.minCents) return PLEDGE_MESSAGES.too_small;
  if (minor > PLEDGE_LIMITS.maxCents) return PLEDGE_MESSAGES.too_big;
  return undefined;
}

/**
 * Checks a pledge's payload. With `actor`, the actor must be the member the pledge names (the writer of a pledge is
 * the member, so a pledge for someone else is refused).
 */
export function checkPledge(input: unknown, actor?: Did): PledgeCheck {
  const o = isObject(input) ? input : {};
  if (!Object.keys(o).every((key) => (PLEDGE_KEYS as readonly string[]).includes(key))) {
    return { ok: false, problem: PLEDGE_MESSAGES.unknown_field };
  }
  const order = typeof o.order === "string" ? o.order.trim().replace(/\s+/g, " ") : "";
  if (order === "") return { ok: false, problem: PLEDGE_MESSAGES.no_order };
  const member = typeof o.member === "string" ? o.member : "";
  if (actor !== undefined && member !== actor) {
    return { ok: false, problem: PLEDGE_MESSAGES.wrong_member };
  }
  const amount = isObject(o.amount) ? o.amount : {};
  if (Object.keys(amount).some((key) => key !== "currency" && key !== "minor")) {
    return { ok: false, problem: PLEDGE_MESSAGES.unknown_field };
  }
  if (amount.currency !== PLEDGE_LIMITS.currency)
    return { ok: false, problem: PLEDGE_MESSAGES.not_zar };
  const problem = amountProblem(amount.minor);
  if (problem !== undefined) return { ok: false, problem };
  return {
    ok: true,
    value: { order, member: member as Did, minor: amount.minor as number },
  };
}

/** The view key of a member's latest pledge for an order. The order name is encoded, so no name can clash. */
export const pledgeKey = (order: string, member: string) =>
  `pledges/${encodeURIComponent(order)}/${member}`;

/** The view key of a pledge by its event id. */
export const pledgeEventKey = (eventId: string) => `pledge-events/${eventId}`;

/** The view key of the Node's payment request for a pledge. */
export const paymentKey = (pledgeEventId: string) => `payments/${pledgeEventId}`;

/** A pledge as the view holds it. */
export interface StoredPledge {
  readonly order: string;
  readonly member: Did;
  readonly minor: number;
  /** The event id of the pledge (a payment names it as its external reference). */
  readonly event: string;
  /** The time the member's phone gave the pledge (its `claimedAt`). A payment window is counted from it. */
  readonly claimedAt: number;
}

function storedOf(value: unknown): StoredPledge | undefined {
  if (!isObject(value)) return undefined;
  if (typeof value.order !== "string" || typeof value.member !== "string") return undefined;
  if (typeof value.minor !== "number" || typeof value.event !== "string") return undefined;
  if (typeof value.claimedAt !== "number") return undefined;
  return {
    order: value.order,
    member: value.member as Did,
    minor: value.minor,
    event: value.event,
    claimedAt: value.claimedAt,
  };
}

/** The member's latest pledge for an order, as the view holds it. */
export async function pledgeOf(
  view: ViewReader,
  order: string,
  member: string,
): Promise<StoredPledge | undefined> {
  return storedOf(await view.get(pledgeKey(order, member)));
}

/** A pledge by its event id, or undefined when the record does not hold it. */
export async function pledgeByEvent(
  view: ViewReader,
  eventId: string,
): Promise<StoredPledge | undefined> {
  return storedOf(await view.get(pledgeEventKey(eventId)));
}

/**
 * Whether `actor` may pay this pledge, judged on the stored amount: the member's own, and in range. Undefined when it may.
 * The payment route calls it with the pledge read from the record.
 */
export function checkPayable(pledge: StoredPledge, actor: string): string | undefined {
  if (pledge.member !== actor) return PLEDGE_MESSAGES.pay_not_yours;
  return amountProblem(pledge.minor);
}

/** The JSON a pledge is stored as in the view. */
export function pledgeJson(event: string, fields: PledgeFields, claimedAt: number): JsonObject {
  return { order: fields.order, member: fields.member, minor: fields.minor, event, claimedAt };
}
