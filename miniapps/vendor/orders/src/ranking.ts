// The Orders screen's ranking, in plain words. Pure: no React, so it is tested without a phone. The
// ranking itself is `rankQuotes` in @shopong/community; this turns its result into the sentences a person
// reads, and turns what the treasurer typed for "what the order needs" into the input it takes.

import {
  RANKING_RULE,
  RANKING_THRESHOLD_PERCENT,
  rankQuotes,
  tidy,
  type IncompleteQuote,
  type Margin,
  type Quote,
  type Ranking,
  type Wanted,
} from "@shopong/community";

import { deliveryText, parseWhole, randText } from "./form";

/** One line of "what the order needs", as typed. */
export interface WantDraft {
  readonly item: string;
  /** Units wanted, as typed. */
  readonly quantity: string;
}

/** The wanted items the treasurer typed. A row with neither name nor quantity is dropped; a quantity that is not a whole number stays `NaN`, which `rankQuotes` refuses with a plain reason. */
export function wantedFromDrafts(drafts: readonly WantDraft[]): Wanted[] {
  return drafts
    .filter((draft) => draft.item.trim() !== "" || draft.quantity.trim() !== "")
    .map((draft) => ({ item: draft.item, quantity: parseWhole(draft.quantity) ?? Number.NaN }));
}

const DIGITS_ONLY = /^\d+$/;

/** A quantity typed with a comma, a space, a point or a letter. Read here, because `NaN` alone cannot say what was typed. */
function quantityTextProblems(drafts: readonly WantDraft[]): string[] {
  return drafts.flatMap((draft) => {
    const typed = draft.quantity.trim();
    if (typed === "" || DIGITS_ONLY.test(typed)) return [];
    const label = tidy(draft.item) || "an item";
    return [
      `The quantity of ${label} must be a whole number. Write the number without commas or spaces, for example 1000.`,
    ];
  });
}

/** One ranked supplier, as a person reads it. */
export interface RankRow {
  readonly rank: number;
  readonly supplier: string;
  /** The total in rand, for example "R125.00". */
  readonly total: string;
  /** The delivery terms, for example "free, same day". */
  readonly delivery: string;
  /** The margin to the next supplier in words. Absent for the last row. */
  readonly next: string | undefined;
}

export interface RankingView {
  /** The result in one sentence. */
  readonly headline: string;
  /** The rule in plain words, as written in the plan. */
  readonly rule: string;
  /** What was ranked, in the order typed, for example "Sugar 10, Maize meal 2". */
  readonly rankedFor: string;
  readonly rows: readonly RankRow[];
  /** One sentence per quote that cannot be compared, with what is missing. */
  readonly cannotCompare: readonly string[];
}

/** "a", "a and b", "a, b and c". */
function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "R12.50 cheaper than the next supplier (the next one costs 10.0% more)", from a floored margin in tenths of a percent. A positive margin under 0.1% is "less than 0.1%", never "0.0%". */
function nextText(margin: Margin): string {
  if (margin.cents === 0) return "Same total as the next supplier.";
  const share =
    margin.permille === 0
      ? "less than 0.1%"
      : `${Math.floor(margin.permille / 10)}.${margin.permille % 10}%`;
  return `${randText(margin.cents)} cheaper than the next supplier (the next one costs ${share} more)`;
}

function headlineOf(ranking: Ranking): string {
  const { recommendation, ranked } = ranking;
  switch (recommendation.kind) {
    case "clear":
      return `Lowest total: ${recommendation.supplier}. The next supplier costs at least ${RANKING_THRESHOLD_PERCENT}% more.`;
    case "too_close":
      return ranked[0]?.margin?.cents === 0
        ? "No clear recommendation. The two lowest totals are the same."
        : `No clear recommendation. The next supplier is within ${RANKING_THRESHOLD_PERCENT}%, so we don't pick one.`;
    case "only_one":
      return ranking.incomplete.length > 0
        ? "Only one quote can be compared so far."
        : "Only one quote, so there is nothing to compare it with yet.";
    case "none":
      return "No quotes to compare yet.";
  }
}

const cannotCompareText = (quote: IncompleteQuote): string =>
  `Can't compare ${quote.supplier}: missing ${listWords(quote.missing)}.`;

/** The ranking as sentences for the screen. */
export function describeRanking(ranking: Ranking, rankedFor = ""): RankingView {
  return {
    headline: headlineOf(ranking),
    rule: RANKING_RULE,
    rankedFor,
    rows: ranking.ranked.map((row) => ({
      rank: row.rank,
      supplier: row.supplier,
      total: randText(row.totalCents),
      delivery: deliveryText(row.delivery),
      next: row.margin === undefined ? undefined : nextText(row.margin),
    })),
    cannotCompare: ranking.incomplete.map(cannotCompareText),
  };
}

/** "Sugar 10, Maize meal 2": the wanted items and quantities, in the order typed. */
const rankedForText = (wanted: readonly Wanted[]): string =>
  wanted.map((want) => `${tidy(want.item)} ${want.quantity}`).join(", ");

/**
 * The screen's ranking for one order: only the quotes whose order name is this one, ranked for what the
 * treasurer typed. Returns the plain reasons instead when the typed needs cannot be ranked.
 */
export function orderRanking(
  quotes: readonly Quote[],
  drafts: readonly WantDraft[],
  order: string,
):
  | { readonly ok: true; readonly view: RankingView }
  | { readonly ok: false; readonly problems: readonly string[] } {
  const textProblems = quantityTextProblems(drafts);
  if (textProblems.length > 0) return { ok: false, problems: [...textProblems].sort() };
  const wanted = wantedFromDrafts(drafts);
  const result = rankQuotes(
    quotes.filter((quote) => quote.order === tidy(order)),
    wanted,
  );
  if (!result.ok) return result;
  return { ok: true, view: describeRanking(result.value, rankedForText(wanted)) };
}

/**
 * The items an order records, as the rows the ranking reads (story 8.2): the proposal holds the list, so every phone ranks
 * the quotes against the same items, in the same order.
 */
export function draftsFromWanted(items: readonly Wanted[]): WantDraft[] {
  return items.map((want) => ({ item: want.item, quantity: String(want.quantity) }));
}
