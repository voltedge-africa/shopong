// Ranking the supplier quotes for one order by a simple rule (story 6.9). Pure: the same quotes and the
// same wanted items give the same result, in any order, on any device. No model, no weighting by
// reliability or reviews, and nothing is chosen here; a person chooses the supplier.
//
// The total for a supplier is, for each wanted item, the cheapest line that names it, with packs counted
// up (7 units from packs of 5 is 2 packs), plus the delivery fee once. Money is integer cents, and every
// sum and product is BigInt, so nothing rounds or overflows. A total that is not a safe integer is refused.
//
// The margin to the next supplier is the difference in cents, and its size as a share of the lower total,
// floored to tenths of a percent. A lowest total is recommended only when that share is at least the
// threshold (3%), compared exactly with integers.
//
// Item names are matched after tidying and ignoring case (S-6.9-1). A quote missing a wanted item is
// listed as incomplete and not ranked (plan decision 3A).

import { QUOTE_LIMITS, tidy, type DeliveryTerms, type Quote } from "./quotes.js";

/** The margin the lowest total must have over the next supplier, as a percentage of the lowest total. */
export const RANKING_THRESHOLD_PERCENT = 3;

/** The rule in plain words, shown on the Orders screen. */
export const RANKING_RULE = `Lowest total wins. If the next supplier is within ${RANKING_THRESHOLD_PERCENT}% we don't pick one.`;

/** The most the wanted list may hold, and the most units of one item it may ask for. */
export const WANT_LIMITS = { items: 50, quantity: 10_000 } as const;

/** One thing the order needs: an item name and how many units of it. */
export interface Wanted {
  readonly item: string;
  readonly quantity: number;
}

/** How far the next ranked supplier is above this one. `permille` is floored: 54 is 5.4%. */
export interface Margin {
  readonly cents: number;
  readonly permille: number;
}

export interface RankedQuote {
  readonly rank: number;
  readonly supplier: string;
  readonly totalCents: number;
  readonly delivery: DeliveryTerms;
  /** To the next ranked supplier. Absent for the last one. */
  readonly margin?: Margin;
}

export interface IncompleteQuote {
  readonly supplier: string;
  /** The wanted items this quote does not name, in the order they were wanted. */
  readonly missing: readonly string[];
}

export type Recommendation =
  | { readonly kind: "clear"; readonly supplier: string }
  | { readonly kind: "too_close" }
  | { readonly kind: "only_one" }
  | { readonly kind: "none" };

export interface Ranking {
  readonly ranked: readonly RankedQuote[];
  readonly incomplete: readonly IncompleteQuote[];
  readonly recommendation: Recommendation;
}

export type RankCheck =
  | { readonly ok: true; readonly value: Ranking }
  | { readonly ok: false; readonly problems: readonly string[] };

export interface WantedItem {
  readonly text: string;
  readonly key: string;
  readonly quantity: number;
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Case-insensitive, tidied key for matching item names. */
const keyOf = (text: string): string => tidy(text).toLowerCase();

/**
 * The items an order needs, checked as ranking checks them (story 6.9) and as a proposal records them (story 8.2). The
 * items come back tidied and sorted by name, so every phone reads the same list.
 */
export function checkWanted(
  wanted: readonly Wanted[],
): { ok: true; items: WantedItem[] } | { ok: false; problems: string[] } {
  if (wanted.length === 0) return { ok: false, problems: ["Add the items the order needs."] };
  if (wanted.length > WANT_LIMITS.items)
    return { ok: false, problems: [`The order can have at most ${WANT_LIMITS.items} items.`] };
  // "10,000", written out without Intl so it reads the same on every device.
  const maxText = String(WANT_LIMITS.quantity).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  const problems: string[] = [];
  const items: WantedItem[] = wanted.map((want) => {
    const text = tidy(want.item);
    if (text === "") problems.push("Name each item the order needs.");
    else if (text.length > QUOTE_LIMITS.nameChars)
      problems.push(`Keep the name of ${text} to ${QUOTE_LIMITS.nameChars} characters or fewer.`);
    const label = text === "" ? "an item" : text;
    if (!Number.isSafeInteger(want.quantity) || want.quantity < 1)
      problems.push(`The quantity of ${label} must be a whole number, 1 or more.`);
    else if (want.quantity > WANT_LIMITS.quantity)
      problems.push(`The quantity of ${label} is too large. Use ${maxText} or fewer.`);
    return { text, key: keyOf(want.item), quantity: want.quantity };
  });

  // Each item once. The name shown is the smaller of the spellings, so the same input always reads the same.
  const byKey = new Map<string, string[]>();
  for (const item of items) byKey.set(item.key, [...(byKey.get(item.key) ?? []), item.text]);
  for (const [key, texts] of [...byKey].sort(([a], [b]) => byText(a, b))) {
    if (texts.length > 1) {
      const shown = [...texts].sort(byText)[0] ?? key;
      problems.push(`Name each item once: ${shown} is listed more than once.`);
    }
  }

  if (problems.length > 0) return { ok: false, problems: [...problems].sort(byText) };
  return { ok: true, items: [...items].sort((a, b) => byText(a.key, b.key)) };
}

/**
 * Ranks the complete quotes for an order. A quote is complete when it names every wanted item; the rest
 * are listed as incomplete. Returns the reasons instead of a ranking when the input cannot be ranked.
 */
export function rankQuotes(quotes: readonly Quote[], wanted: readonly Wanted[]): RankCheck {
  const want = checkWanted(wanted);
  if (!want.ok) return want;

  const problems: string[] = [];
  const names = new Map<string, number>();
  for (const quote of quotes) names.set(quote.supplier, (names.get(quote.supplier) ?? 0) + 1);
  for (const [name, count] of [...names].sort(([a], [b]) => byText(a, b)))
    if (count > 1) problems.push(`Two quotes name the same supplier: ${name}.`);

  interface Priced {
    readonly supplier: string;
    readonly total: bigint;
    readonly delivery: DeliveryTerms;
    readonly missing: readonly string[];
  }
  // Not sorted here: the order of the quotes is decided by the total and the supplier name below, so
  // input order cannot matter.
  const priced: Priced[] = quotes.map((quote) => {
    let total = BigInt(quote.delivery.feeCents);
    const missing: string[] = [];
    for (const item of want.items) {
      const usable = quote.lines.filter((line) => keyOf(line.item) === item.key);
      if (usable.length === 0) {
        missing.push(item.text);
        continue;
      }
      let cheapest: bigint | undefined;
      for (const line of usable) {
        if (
          !Number.isSafeInteger(line.packSize) ||
          line.packSize < 1 ||
          !Number.isSafeInteger(line.pricePerPackCents) ||
          line.pricePerPackCents < 1
        ) {
          problems.push(`${quote.supplier}: ${line.item} has no usable pack size or price.`);
          continue;
        }
        // Packs are counted up: ceiling division on BigInt.
        const size = BigInt(line.packSize);
        const packs = (BigInt(item.quantity) + size - 1n) / size;
        const cost = packs * BigInt(line.pricePerPackCents);
        if (cheapest === undefined || cost < cheapest) cheapest = cost;
      }
      if (cheapest !== undefined) total += cheapest;
    }
    if (missing.length === 0 && total > BigInt(Number.MAX_SAFE_INTEGER))
      problems.push(`The total for ${quote.supplier} is too large to compare.`);
    return {
      supplier: quote.supplier,
      total,
      delivery: { feeCents: quote.delivery.feeCents, days: quote.delivery.days },
      missing,
    };
  });

  if (problems.length > 0) return { ok: false, problems: [...problems].sort(byText) };

  const complete = priced
    .filter((p) => p.missing.length === 0)
    .sort((a, b) =>
      a.total < b.total ? -1 : a.total > b.total ? 1 : byText(a.supplier, b.supplier),
    );

  const ranked: RankedQuote[] = complete.map((p, index) => {
    const next = complete[index + 1];
    const margin =
      next === undefined
        ? undefined
        : {
            cents: Number(next.total - p.total),
            permille: Number(((next.total - p.total) * 1000n) / p.total),
          };
    return {
      rank: index + 1,
      supplier: p.supplier,
      totalCents: Number(p.total),
      delivery: p.delivery,
      margin,
    };
  });

  const incomplete: IncompleteQuote[] = priced
    .filter((p) => p.missing.length > 0)
    .sort((a, b) => byText(a.supplier, b.supplier))
    .map((p) => ({ supplier: p.supplier, missing: p.missing }));

  const [first, second] = complete;
  let recommendation: Recommendation;
  if (first === undefined) recommendation = { kind: "none" };
  else if (second === undefined) recommendation = { kind: "only_one" };
  else if ((second.total - first.total) * 100n >= BigInt(RANKING_THRESHOLD_PERCENT) * first.total)
    recommendation = { kind: "clear", supplier: first.supplier };
  else recommendation = { kind: "too_close" };

  return { ok: true, value: { ranked, incomplete, recommendation } };
}
