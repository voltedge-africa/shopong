// A bulk order a phone with a Node proposes or approves is sent to the Node's record as an `order.proposed` or
// `order.approved` event (story 8.2), the same way a quote is. The phone checks a proposal with the record's own rules
// first, at the record's log time, so a refused proposal is never sent. The Orders screen reads the orders from the
// synced view, so an order the Node refused does not show as recorded.
import {
  ORDER_MESSAGES,
  checkOrder,
  orderGateProblem,
  orderKey,
  orderPayloadOf,
  proposalProblem,
  SELECTION_MESSAGES,
  selectionPayloadOf,
  storedOrderOf,
  supplierTotalOf,
  type GatedAction,
  type StoredOrder,
} from "@shopong/community";
import { createEvent, type EventEnvelope } from "@shopong/events";
import type { Did, JsonValue } from "@shopong/ports";

import { quotesOfView } from "./quotes";

type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problems: readonly string[] };

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** The record's log time as the synced view holds it (0 before the first accepted event, as `apply` reads it). */
export function logTimeIn(view: ReadonlyMap<string, JsonValue>): number {
  const value = view.get("log/time");
  return typeof value === "number" ? value : 0;
}

/** Every order on the record, as the synced view holds it. */
export function ordersInView(view: ReadonlyMap<string, JsonValue>): readonly StoredOrder[] {
  const out: StoredOrder[] = [];
  for (const [key, value] of view) {
    if (!key.startsWith("orders/")) continue;
    const stored = storedOrderOf(value);
    if (stored !== undefined) out.push(stored);
  }
  return out;
}

/** How many members the synced view holds. */
export function memberCountIn(view: ReadonlyMap<string, JsonValue>): number {
  let count = 0;
  for (const key of view.keys()) if (key.startsWith("members/")) count += 1;
  return count;
}

/**
 * Why a quote or a pledge for `order` is held back, as the record would judge it at its log time, or undefined when it may
 * go. Only the name matters here: a name with no proposal on the record is never held back.
 */
export function gateProblemIn(
  view: ReadonlyMap<string, JsonValue>,
  order: unknown,
  action: GatedAction,
): string | undefined {
  if (typeof order !== "string") return undefined;
  return orderGateProblem(storedOrderOf(view.get(orderKey(order))), action, logTimeIn(view));
}

/**
 * The `order.proposed` event for a proposal the form typed, or the plain reasons it cannot be sent. The rules are the
 * record's: a complete, valid proposal, no phone number in its name or items, a deadline after the log time, and no other
 * order on the record.
 */
export function orderEventOf(input: {
  readonly community: string;
  readonly me: Did;
  readonly now: number;
  readonly randomBytes: (length: number) => Uint8Array;
  readonly input: unknown;
  readonly view: ReadonlyMap<string, JsonValue>;
}): Result<EventEnvelope> {
  const checked = checkOrder(input.input, logTimeIn(input.view));
  if (!checked.ok) return { ok: false, problems: checked.problems };
  const problem = proposalProblem(ordersInView(input.view));
  if (problem !== undefined) return { ok: false, problems: [problem] };
  try {
    const event = createEvent({
      type: "order.proposed",
      space: input.community,
      actor: input.me,
      proof: [],
      claimedAt: input.now,
      nonce: hex(input.randomBytes(16)),
      payload: orderPayloadOf(checked.value),
    } as never) as EventEnvelope;
    return { ok: true, value: event };
  } catch {
    return { ok: false, problems: ["The order could not be saved. Try again."] };
  }
}

/** The `order.approved` event for a proposed order, named by the proposal's event id. */
export function approveEventOf(input: {
  readonly community: string;
  readonly me: Did;
  readonly now: number;
  readonly randomBytes: (length: number) => Uint8Array;
  readonly order: string;
}): EventEnvelope {
  return createEvent({
    type: "order.approved",
    space: input.community,
    actor: input.me,
    proof: [],
    claimedAt: input.now,
    nonce: hex(input.randomBytes(16)),
    payload: { order: input.order },
  } as never) as EventEnvelope;
}

/**
 * The `quote.selected` event for a supplier the treasurer chose on an approved order (story 8.3), or the plain reasons it
 * cannot be sent. The total is the ranking's own, from this phone's copy of the order and its quotes; the record recomputes
 * it and keeps the latest choice.
 */
export function chooseEventOf(input: {
  readonly community: string;
  readonly me: Did;
  readonly now: number;
  readonly randomBytes: (length: number) => Uint8Array;
  readonly order: string;
  readonly supplier: string;
  readonly view: ReadonlyMap<string, JsonValue>;
}): Result<EventEnvelope> {
  const order = storedOrderOf(input.view.get(orderKey(input.order)));
  if (order === undefined) return { ok: false, problems: [ORDER_MESSAGES.unknown_order] };
  if (order.status !== "open") return { ok: false, problems: [SELECTION_MESSAGES.not_approved] };
  const priced = supplierTotalOf(quotesOfView(input.view, order.name), order.items, input.supplier);
  if (!priced.ok) return { ok: false, problems: [priced.problem] };
  try {
    const event = createEvent({
      type: "quote.selected",
      space: input.community,
      actor: input.me,
      proof: [],
      claimedAt: input.now,
      nonce: hex(input.randomBytes(16)),
      payload: selectionPayloadOf({
        order: order.name,
        supplier: input.supplier,
        totalMinor: priced.totalMinor,
      }),
    } as never) as EventEnvelope;
    return { ok: true, value: event };
  } catch {
    return { ok: false, problems: [SELECTION_MESSAGES.save_failed] };
  }
}
