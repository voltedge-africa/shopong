// The Orders screen's comparison of the quotes for one order (story 8.3): the items down the side, the suppliers across, and
// the totals and delivery terms at the bottom. Pure: no React, so it is tested without a phone. The ranking is the record's
// own (`rankQuotes` in @shopong/community, passed in), so the totals here are the ones the choice is recorded at. Each cell
// shows the cheapest line that names the item, with packs counted up, as the ranking counts it.

import { tidy, type Quote, type Ranking, type Selection, type Wanted } from "@shopong/community";

import { deliveryText, randText } from "./form";

/** One item's cell for one supplier: the cost for the units the order needs, and how it is made up. */
export interface CompareCell {
  /** The cost, for example "R300.00". Absent when the supplier's quote does not name the item. */
  readonly cost?: string;
  /** How the cost is made up, for example "1 pack of 12 bottle at R300.00", or "Not on this quote". */
  readonly detail: string;
}

/** One supplier's column. */
export interface CompareColumn {
  readonly supplier: string;
  /** The rank in the ranking, from 1. Absent for a quote that cannot be ranked (it misses an item). */
  readonly rank?: number;
  /** The total for the order's items, for example "R745.80". Absent when the quote cannot be ranked. */
  readonly total?: string;
  /** The delivery terms, for example "free, same day". */
  readonly delivery: string;
  /** One cell per wanted item, in the same order as the rows. */
  readonly cells: readonly CompareCell[];
  /** Whether this supplier is the one the treasurer chose. */
  readonly chosen: boolean;
  /** Whether the treasurer can choose this supplier now: only a complete quote can be chosen. */
  readonly canChoose: boolean;
  /** A plain note for a quote that cannot be compared, with what is missing. */
  readonly note?: string;
}

export interface ComparisonView {
  /** One row label per wanted item, for example "Cooking oil, 12 units". */
  readonly items: readonly string[];
  readonly columns: readonly CompareColumn[];
  /** The treasurer's choice in one sentence, when there is one. */
  readonly chosenText?: string;
}

/** A line's key for matching item names: tidied and ignoring case, as the ranking matches them (S-6.9-1). */
const keyOf = (text: string): string => tidy(text).toLowerCase();

/** "1 pack of 12 bottle at R300.00", with the unit as typed. */
function packText(packs: number, packSize: number, unit: string, price: number): string {
  const noun = packs === 1 ? "pack" : "packs";
  return `${packs} ${noun} of ${packSize} ${unit} at ${randText(price)}`;
}

/**
 * The cheapest line that names the wanted item, with packs counted up, as the ranking counts it. A line with no usable pack
 * size or price is skipped here; the ranking reports it.
 */
export function cellOf(quote: Quote, want: Wanted): CompareCell {
  const key = keyOf(want.item);
  let best: { cost: number; detail: string } | undefined;
  for (const line of quote.lines) {
    if (keyOf(line.item) !== key) continue;
    if (
      !Number.isSafeInteger(line.packSize) ||
      line.packSize < 1 ||
      !Number.isSafeInteger(line.pricePerPackCents) ||
      line.pricePerPackCents < 1
    ) {
      continue;
    }
    const packs = Math.ceil(want.quantity / line.packSize);
    const cost = packs * line.pricePerPackCents;
    if (best === undefined || cost < best.cost) {
      best = { cost, detail: packText(packs, line.packSize, line.unit, line.pricePerPackCents) };
    }
  }
  if (best === undefined) return { detail: "Not on this quote" };
  return { cost: randText(best.cost), detail: best.detail };
}

/** "Cooking oil, 12 units" (one unit reads "1 unit"). */
const rowLabel = (want: Wanted): string =>
  `${tidy(want.item)}, ${want.quantity} ${want.quantity === 1 ? "unit" : "units"}`;

/** "Missing: Maize meal and Sugar." in plain words, from the ranking's list of what a quote lacks. */
function missingNote(missing: readonly string[]): string {
  const words =
    missing.length <= 1
      ? missing.join("")
      : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
  return `Can't be compared: missing ${words}.`;
}

/**
 * The comparison for one order. `quotes` are the order's quotes, `wanted` the items the order needs (as the proposal holds
 * them), and `ranking` the record's ranking of them (undefined when the needs or the quotes cannot be ranked). Columns are the
 * ranked suppliers in rank order, then the quotes that cannot be ranked by name. `chosen` is the treasurer's latest choice.
 * `canChoose` says whether this person may choose; only a ranked supplier can be chosen.
 */
export function comparisonOf(input: {
  readonly quotes: readonly Quote[];
  readonly wanted: readonly Wanted[];
  readonly ranking: Ranking | undefined;
  readonly chosen: Selection | undefined;
  readonly canChoose: boolean;
}): ComparisonView {
  const { quotes, wanted, ranking, chosen } = input;
  const bySupplier = new Map(quotes.map((quote) => [quote.supplier, quote] as const));
  const rankedNames = new Set(ranking?.ranked.map((row) => row.supplier) ?? []);

  const ranked = (ranking?.ranked ?? []).flatMap((row) => {
    const quote = bySupplier.get(row.supplier);
    if (quote === undefined) return [];
    return [
      {
        supplier: row.supplier,
        rank: row.rank,
        total: randText(row.totalCents),
        delivery: deliveryText(row.delivery),
        quote,
        note: undefined,
        canChoose: input.canChoose,
      },
    ];
  });
  const unranked = quotes
    .filter((quote) => !rankedNames.has(quote.supplier))
    .sort((a, b) => (a.supplier < b.supplier ? -1 : a.supplier > b.supplier ? 1 : 0))
    .map((quote) => {
      const missing = ranking?.incomplete.find((row) => row.supplier === quote.supplier);
      return {
        supplier: quote.supplier,
        rank: undefined,
        total: undefined,
        delivery: deliveryText(quote.delivery),
        quote,
        note: missing === undefined ? "Not ranked yet." : missingNote(missing.missing),
        canChoose: false,
      };
    });

  const columns: CompareColumn[] = [...ranked, ...unranked].map((entry) => ({
    supplier: entry.supplier,
    ...(entry.rank === undefined ? {} : { rank: entry.rank }),
    ...(entry.total === undefined ? {} : { total: entry.total }),
    delivery: entry.delivery,
    cells: wanted.map((want) => cellOf(entry.quote, want)),
    chosen: chosen !== undefined && chosen.supplier === entry.supplier,
    canChoose: entry.canChoose,
    ...(entry.note === undefined ? {} : { note: entry.note }),
  }));

  const chosenText =
    chosen === undefined
      ? undefined
      : `Chosen: ${chosen.supplier}, ${randText(chosen.totalMinor)}. That total is the pool's target.`;

  return {
    items: wanted.map(rowLabel),
    columns,
    ...(chosenText === undefined ? {} : { chosenText }),
  };
}
