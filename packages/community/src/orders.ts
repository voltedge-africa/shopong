// Proposed bulk grocery orders (story 8.2). A member proposes an order as one `order.proposed` event: its name, the items
// it needs (each with a quantity), a budget per member in whole rand cents, and a deadline (epoch milliseconds). The
// proposal's event id is the order's identity. The treasurer then approves it with `order.approved`, which opens it to
// quotes and pledges. Until then, and after the deadline at log time, quotes and pledges for it are refused.
//
// The view keeps every existing key by the TIDIED ORDER NAME (quotes, pledges, payouts, files, delivery and proof all
// use it, so none is re-keyed): `orders/<tidied name>` holds the proposal, and `order-ids/<event id>` names it by its id.
// The name is unique on the record, because one open order at a time is the rule for the demo (S-8.2-2); closing an
// order is not applied yet, so any order on the record counts as open.
//
// Pure functions here are used by `apply` (the record), the community's builders and the phone's own checks. Nothing reads
// a clock: the time they judge is log time, passed in (AGENTS rule 3, log-time.ts).

import { hasIdNumberShape, hasPhoneNumberShape, type JsonObject } from "@shopong/events";
import type { EpochMs, ViewReader } from "@shopong/ports";
import { QUOTE_LIMITS, QUOTE_MESSAGES, tidy } from "./quotes.js";
import { checkWanted, type Wanted } from "./rank.js";

/** The most a member's budget may be: R100,000.00, in whole rand cents. */
export const ORDER_BUDGET_MAX_CENTS = 10_000_000;

/** The plain sentences a person sees. Each is one sentence, as the record and the screen show it. */
export const ORDER_MESSAGES = {
  not_member: "Only a member can propose an order.",
  unreadable: "This order can't be read.",
  no_name: "Name the order.",
  name_control: "The order name has a character that cannot be used. Type it again on one line.",
  name_long: `Keep the order name to ${QUOTE_LIMITS.nameChars} characters or fewer.`,
  no_budget: "Add a budget per member.",
  budget_whole: "Write the budget per member in rand, like 150 or 150.50.",
  budget_zero: "The budget per member must be more than R0.00.",
  budget_max: "The budget per member must be R100,000.00 or less.",
  no_deadline: "Add a deadline.",
  deadline_bad: "The deadline must be a date.",
  deadline_passed: "The deadline has already passed.",
  already_open: "An order is already open.",
  duplicate: "This order is already recorded.",
  quotes_not_open: "Quotes open once the treasurer approves the order.",
  pledges_not_open: "Pledges open once the treasurer approves the order.",
  approve_not_permitted: "Only the treasurer can approve an order.",
  unknown_order: "This order is not on the record.",
  already_approved: "This order is already approved.",
  not_writable: "Your phone is not set up to write to this community yet.",
  save_failed: "The order could not be saved. Try again.",
} as const;

/** The two things a deadline and an approval gate: a quote, or a pledge. */
export type GatedAction = "quote" | "pledge";

/** A proposal as the record holds it, checked. */
export interface OrderFields {
  readonly name: string;
  readonly items: readonly Wanted[];
  readonly budgetPerMemberMinor: number;
  /** Epoch milliseconds. Quotes and pledges are refused once log time reaches it. */
  readonly deadline: number;
}

export type OrderCheck =
  | { readonly ok: true; readonly value: OrderFields }
  | { readonly ok: false; readonly problems: readonly string[] };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A control character: anything below a space, or DEL. */
const hasControl = (text: string): boolean =>
  text.split("").some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127);

/** A phone or ID number in a name, by the same shape rule the record's guard uses. */
const personalShape = (text: string): boolean =>
  hasPhoneNumberShape(text) || hasIdNumberShape(text);

/** The deadline window the record accepts: 2020 to 2100, in epoch milliseconds (the registry's window). */
const DEADLINE_MIN = 1_577_836_800_000;
const DEADLINE_MAX = 4_102_444_800_000;

/**
 * Checks a proposal against the rules at log time `at`. Every problem is returned, in the order a person would fix them,
 * and nothing is judged on the sender's word about the time: the deadline must be after `at`.
 */
export function checkOrder(input: unknown, at: EpochMs): OrderCheck {
  const o = isObject(input) ? input : {};
  const problems: string[] = [];

  const name = typeof o.name === "string" ? tidy(o.name) : "";
  const rawName = typeof o.name === "string" ? o.name : "";
  if (hasControl(rawName)) problems.push(ORDER_MESSAGES.name_control);
  if (name === "") problems.push(ORDER_MESSAGES.no_name);
  else if (personalShape(name)) problems.push(QUOTE_MESSAGES.order_phone);
  if (name.length > QUOTE_LIMITS.nameChars) problems.push(ORDER_MESSAGES.name_long);

  const rawItems = Array.isArray(o.items) ? o.items : [];
  const wanted: Wanted[] = rawItems.map((raw) => {
    const line = isObject(raw) ? raw : {};
    return {
      item: typeof line.item === "string" ? line.item : "",
      quantity: line.quantity as number,
    };
  });
  const itemChecked = checkWanted(wanted);
  if (!itemChecked.ok) problems.push(...itemChecked.problems);
  if (wanted.some((want) => personalShape(tidy(want.item))))
    problems.push(QUOTE_MESSAGES.item_phone);

  const budget = o.budgetPerMemberMinor;
  if (budget === undefined || budget === null || budget === "") {
    problems.push(ORDER_MESSAGES.no_budget);
  } else if (typeof budget !== "number" || !Number.isSafeInteger(budget)) {
    problems.push(ORDER_MESSAGES.budget_whole);
  } else if (budget <= 0) {
    problems.push(ORDER_MESSAGES.budget_zero);
  } else if (budget > ORDER_BUDGET_MAX_CENTS) {
    problems.push(ORDER_MESSAGES.budget_max);
  }

  const deadline = o.deadline;
  if (deadline === undefined || deadline === null || deadline === "") {
    problems.push(ORDER_MESSAGES.no_deadline);
  } else if (
    typeof deadline !== "number" ||
    !Number.isSafeInteger(deadline) ||
    deadline < DEADLINE_MIN ||
    deadline > DEADLINE_MAX
  ) {
    problems.push(ORDER_MESSAGES.deadline_bad);
  } else if (deadline <= at) {
    problems.push(ORDER_MESSAGES.deadline_passed);
  }

  if (problems.length > 0 || !itemChecked.ok) return { ok: false, problems };
  return {
    ok: true,
    value: {
      name,
      items: itemChecked.items.map((item) => ({ item: item.text, quantity: item.quantity })),
      budgetPerMemberMinor: budget as number,
      deadline: deadline as number,
    },
  };
}

/** The payload a checked proposal is written as (the strict form `order.proposed` takes). */
export function orderPayloadOf(order: OrderFields): JsonObject {
  return {
    name: order.name,
    items: order.items.map((item) => ({ item: item.item, quantity: item.quantity })),
    budgetPerMemberMinor: order.budgetPerMemberMinor,
    deadline: order.deadline,
  };
}

export type OrderStatus = "proposed" | "open";

/** An order as the view holds it. `id` is the proposal's event id, which is the order's identity. */
export interface StoredOrder extends OrderFields {
  readonly id: string;
  readonly proposedBy: string;
  readonly status: OrderStatus;
}

/** The view key of an order, by its tidied name. The name is encoded, so no name can clash with a path. */
export const orderKey = (name: string) => `orders/${encodeURIComponent(tidy(name))}`;

/** The view key that names an order by its proposal's event id. */
export const orderIdKey = (id: string) => `order-ids/${id}`;

/** An order as the view holds it, or undefined when the value is not an order. */
export function storedOrderOf(value: unknown): StoredOrder | undefined {
  if (!isObject(value)) return undefined;
  const { id, name, items, budgetPerMemberMinor, deadline, proposedBy, status } = value;
  if (typeof id !== "string" || typeof name !== "string") return undefined;
  if (typeof proposedBy !== "string") return undefined;
  if (status !== "proposed" && status !== "open") return undefined;
  if (typeof budgetPerMemberMinor !== "number" || typeof deadline !== "number") return undefined;
  if (!Array.isArray(items)) return undefined;
  const wanted: Wanted[] = [];
  for (const raw of items) {
    if (!isObject(raw) || typeof raw.item !== "string" || typeof raw.quantity !== "number") {
      return undefined;
    }
    wanted.push({ item: raw.item, quantity: raw.quantity });
  }
  return {
    id,
    name,
    items: wanted,
    budgetPerMemberMinor,
    deadline,
    proposedBy,
    status,
  };
}

/** The JSON an order is stored as in the view. */
export function orderJson(order: StoredOrder): JsonObject {
  return {
    id: order.id,
    name: order.name,
    items: order.items.map((item) => ({ item: item.item, quantity: item.quantity })),
    budgetPerMemberMinor: order.budgetPerMemberMinor,
    deadline: order.deadline,
    proposedBy: order.proposedBy,
    status: order.status,
  };
}

/** Every order on the record, in view-key order. */
export async function ordersOf(view: ViewReader): Promise<readonly StoredOrder[]> {
  const out: StoredOrder[] = [];
  for (const entry of await view.list("orders/")) {
    const stored = storedOrderOf(entry.value);
    if (stored !== undefined) out.push(stored);
  }
  return out;
}

/**
 * Whether a new proposal may be recorded, given the orders already on the record. One open order at a time (S-8.2-2):
 * until an order is closed, any order on the record is open, so a second proposal waits.
 */
export function proposalProblem(existing: readonly StoredOrder[]): string | undefined {
  return existing.length > 0 ? ORDER_MESSAGES.already_open : undefined;
}

/**
 * Whether a quote or a pledge may be recorded for a named order at log time `at`. A name with no proposal on the record
 * returns undefined: such orders keep working as they did before proposals (S-8.2-1). Otherwise the order must be
 * approved, and log time must not have reached its deadline.
 */
export function orderGateProblem(
  order: StoredOrder | undefined,
  action: GatedAction,
  at: EpochMs,
): string | undefined {
  if (order === undefined) return undefined;
  if (order.status !== "open") {
    return action === "quote" ? ORDER_MESSAGES.quotes_not_open : ORDER_MESSAGES.pledges_not_open;
  }
  if (at >= order.deadline) return ORDER_MESSAGES.deadline_passed;
  return undefined;
}
