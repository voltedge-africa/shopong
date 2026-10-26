// The treasurer's choice of a supplier for an order (story 8.3). A choice is a `quote.selected` event naming the order and the
// supplier. `apply` checks the choice against the record: the order is approved, the supplier has a complete quote for its
// wanted items, and the treasurer (the creator, or a co-treasurer standing at log time) made it. The total is RECOMPUTED
// from that quote with the same `rankQuotes` the Orders screen uses; a total claimed in the event that differs is ignored
// and the recomputed one is kept. The latest accepted choice for an order stands, and the earlier ones stay in the log.
//
// The pool target and the supplier payment read this choice (`selectionOf`), so they agree with the screen by construction.
// Pure functions here are used by `apply`, the community's builders and the phone's own checks. Nothing reads a clock.

import type { JsonObject } from "@shopong/events";
import type { ViewReader } from "@shopong/ports";
import { rankQuotes, type Wanted } from "./rank.js";
import { tidy, type Quote } from "./quotes.js";

/** The plain sentences a person sees for a choice. */
export const SELECTION_MESSAGES = {
  not_permitted: "Only the treasurer can choose a supplier.",
  unreadable: "This choice can't be read.",
  not_approved: "Approve the order first.",
  no_quote: "No quote from that supplier for this order.",
  incomplete: "That supplier's quote is missing an item, so it can't be chosen.",
  not_writable: "Your phone is not set up to write to this community yet.",
  save_failed: "The choice could not be saved. Try again.",
} as const;

/** The view key of the latest accepted choice for an order. The name is encoded, so no name can clash with a path. */
export const selectionKey = (order: string) => `selections/${encodeURIComponent(tidy(order))}`;

/** A choice as the view holds it: the order's name, the supplier, the recomputed total in whole cents, who chose and the event. */
export interface Selection {
  readonly order: string;
  readonly supplier: string;
  readonly totalMinor: number;
  /** The DID of the treasurer who chose. */
  readonly by: string;
  /** The event id of the `quote.selected` that made the choice. */
  readonly eventId: string;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A choice as the view holds it, or undefined when the value is not a choice. */
export function storedSelectionOf(value: unknown): Selection | undefined {
  if (!isObject(value)) return undefined;
  const { order, supplier, totalMinor, by, eventId } = value;
  if (typeof order !== "string" || typeof supplier !== "string") return undefined;
  if (typeof by !== "string" || typeof eventId !== "string") return undefined;
  if (typeof totalMinor !== "number" || !Number.isSafeInteger(totalMinor) || totalMinor < 0) {
    return undefined;
  }
  return { order, supplier, totalMinor, by, eventId };
}

/** The latest accepted choice for an order, as the view holds it now. */
export async function selectionOf(view: ViewReader, order: string): Promise<Selection | undefined> {
  return storedSelectionOf(await view.get(selectionKey(order)));
}

/** The JSON a choice is stored as in the view. */
export function selectionJson(selection: Selection): JsonObject {
  return {
    order: selection.order,
    supplier: selection.supplier,
    totalMinor: selection.totalMinor,
    by: selection.by,
    eventId: selection.eventId,
  };
}

/** The payload a choice is written as (the strict form `quote.selected` takes). */
export function selectionPayloadOf(input: {
  readonly order: string;
  readonly supplier: string;
  readonly totalMinor: number;
}): JsonObject {
  return { order: tidy(input.order), supplier: tidy(input.supplier), totalMinor: input.totalMinor };
}

/**
 * The total for one supplier's quote on an order, in whole cents, as the Orders screen ranks it. The quotes and the wanted
 * items are the record's own, so the figure is the same on every phone and in `apply`. A supplier with no quote, or whose
 * quote misses a wanted item, has no total to choose.
 */
export function supplierTotalOf(
  quotes: readonly Quote[],
  wanted: readonly Wanted[],
  supplier: string,
):
  | { readonly ok: true; readonly totalMinor: number }
  | { readonly ok: false; readonly problem: string } {
  const name = tidy(supplier);
  const ranked = rankQuotes(quotes, wanted);
  if (!ranked.ok) return { ok: false, problem: ranked.problems.join(" ") };
  const row = ranked.value.ranked.find((candidate) => candidate.supplier === name);
  if (row !== undefined) return { ok: true, totalMinor: row.totalCents };
  if (!quotes.some((quote) => quote.supplier === name)) {
    return { ok: false, problem: SELECTION_MESSAGES.no_quote };
  }
  return { ok: false, problem: SELECTION_MESSAGES.incomplete };
}
