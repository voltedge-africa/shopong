// Obligations (story 10.1): who owes whom what, by when, and whether it is settled. They are derived on every read from
// the record's view, which `apply` writes only for events it accepted, so a refused event owes nothing. Nothing is stored
// here, so the same events always derive the same obligations on every replica (AGENTS rule 3: no clock, network or
// randomness; the only "now" is log time, `log/time`, which `apply` also judges by).
//
// Two kinds today:
//   pledge    a member's accepted pledge (`pledges/<order>/<member>`, from pledge.created). The member owes the pool (the
//             creator's DID) the pledged amount, due on the order's deadline (`orders/<order>`).
//   supplier  an order's confirmed delivery (`delivered/<order>`, from delivery.confirmed) and the chosen supplier's total
//             (`selections/<order>`). The pool owes the supplier that total, due on the arrival day the driver's phone gave.
//             It is settled when a payout to that supplier, for that order and that amount, is on the record
//             (`payouts/<payment id>`).
//
// Not derived yet (shortcuts S-10.1-*): funding.accepted (no code produces it and it has no payload schema), and a pledge
// is never settled here (a completed bank payment is not applied to the view yet).
//
// State is judged at log time: open before the due day, due for OBLIGATION_GRACE_MS after it, overdue after that, and
// settled once settled.

import type { Did, EpochMs, ViewReader } from "@shopong/ports";
import { deliveredOf } from "./delivery-proof.js";
import { DAY_MS } from "./invitation.js";
import { logTimeOf } from "./log-time.js";
import { tidy } from "./quotes.js";
import { orderKey, storedOrderOf } from "./orders.js";
import { pledgeOf } from "./pledges.js";
import { selectionOf } from "./selection.js";

/** How long an obligation stays "due" after its due day before it is "overdue". Chosen, not measured (S-10.1-5). */
export const OBLIGATION_GRACE_MS = 7 * DAY_MS;

/** The four states, and the plain words a person sees for each. */
export const OBLIGATION_STATES = ["open", "due", "overdue", "settled"] as const;
export type ObligationState = (typeof OBLIGATION_STATES)[number];
export const OBLIGATION_LABELS: Record<ObligationState, string> = {
  open: "Not due yet",
  due: "Due now",
  overdue: "Overdue",
  settled: "Paid",
};

export type ObligationKind = "pledge" | "supplier";

/** One obligation as it stands at log time. */
export interface Obligation {
  /** The event that created it: the member's pledge, or the `delivery.confirmed` of the supplier's delivery. */
  readonly id: string;
  readonly kind: ObligationKind;
  readonly order: string;
  /** Who owes: the member for a pledge, the pool for a supplier payment. */
  readonly debtor: string;
  /** Who is owed: the pool for a pledge, the supplier for a supplier payment. */
  readonly creditor: string;
  /** Whole rand cents. */
  readonly amountMinor: number;
  readonly currency: "ZAR";
  /** The due day, in log time (epoch milliseconds). */
  readonly by: EpochMs;
  readonly settled: boolean;
  readonly state: ObligationState;
}

/** The state of an obligation at log time `now`. Settled wins over every date. */
export function stateOf(input: {
  readonly by: EpochMs;
  readonly settled: boolean;
  readonly now: EpochMs;
}): ObligationState {
  if (input.settled) return "settled";
  if (input.now < input.by) return "open";
  if (input.now < input.by + OBLIGATION_GRACE_MS) return "due";
  return "overdue";
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const PLEDGES = "pledges/";
const DELIVERED = "delivered/";
const PAYOUTS = "payouts/";

/** Whether a payout on the record pays this supplier this amount for this order. */
async function paidTo(
  view: ViewReader,
  order: string,
  supplier: string,
  amountMinor: number,
): Promise<boolean> {
  for (const entry of await view.list(PAYOUTS)) {
    const payout = entry.value;
    if (!isObject(payout)) continue;
    if (typeof payout.order !== "string" || typeof payout.supplier !== "string") continue;
    if (payout.amountMinor !== amountMinor) continue;
    if (tidy(payout.order) === tidy(order) && tidy(payout.supplier) === tidy(supplier)) {
      return true;
    }
  }
  return false;
}

/**
 * Every obligation on the record at log time, in view key order (pledges first, then supplier payments). `creator` is the
 * pool's DID: the creditor of every pledge and the debtor of every supplier payment. An empty record has none.
 */
export async function obligationsOf(
  view: ViewReader,
  creator: Did,
): Promise<readonly Obligation[]> {
  const now = await logTimeOf(view);
  if (now === undefined) return [];
  const found: Obligation[] = [];

  // One pledge per member per order: a later pledge replaces the earlier one in the view, so it is the one owed.
  for (const entry of await view.list(PLEDGES)) {
    const rest = entry.key.slice(PLEDGES.length);
    const cut = rest.lastIndexOf("/");
    if (cut < 0) continue;
    const order = decodeURIComponent(rest.slice(0, cut));
    const pledge = await pledgeOf(view, order, rest.slice(cut + 1));
    if (pledge === undefined) continue;
    const deadline = storedOrderOf(await view.get(orderKey(pledge.order)))?.deadline;
    if (deadline === undefined) continue;
    const settled = false;
    found.push({
      id: pledge.event,
      kind: "pledge",
      order: pledge.order,
      debtor: pledge.member,
      creditor: creator,
      amountMinor: pledge.minor,
      currency: "ZAR",
      by: deadline,
      settled,
      state: stateOf({ by: deadline, settled, now }),
    });
  }

  for (const entry of await view.list(DELIVERED)) {
    const order = decodeURIComponent(entry.key.slice(DELIVERED.length));
    const delivered = await deliveredOf(view, order);
    if (delivered === undefined) continue;
    const selection = await selectionOf(view, order);
    if (selection === undefined) continue;
    const settled = await paidTo(view, order, selection.supplier, selection.totalMinor);
    found.push({
      id: delivered.event,
      kind: "supplier",
      order,
      debtor: creator,
      creditor: selection.supplier,
      amountMinor: selection.totalMinor,
      currency: "ZAR",
      by: delivered.claimedAt,
      settled,
      state: stateOf({ by: delivered.claimedAt, settled, now }),
    });
  }

  return found;
}
