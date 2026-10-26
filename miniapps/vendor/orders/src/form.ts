// The Add-a-quote form's values, as typed, and how they become the input `addQuote` checks. Pure: no
// React, so it is tested without a phone. Rules about what is complete are in `checkQuote`, not here.

export interface LineDraft {
  readonly item: string;
  readonly unit: string;
  /** Units in one pack, as typed. */
  readonly packSize: string;
  /** The price of one pack in rand, as typed, for example "125.50". */
  readonly price: string;
}

export interface FormValues {
  readonly order: string;
  readonly supplier: string;
  readonly lines: readonly LineDraft[];
  /** The delivery fee in rand, as typed. */
  readonly feeText: string;
  /** The delivery days, as typed. */
  readonly daysText: string;
}

export const emptyLine = (): LineDraft => ({ item: "", unit: "", packSize: "", price: "" });

const WHOLE = /^\d+$/;
/** Rand with at most two decimals, and no separator: "125", "125.5", "125.50". */
const PLAIN_RAND = /^\d+(\.\d{1,2})?$/;
/** Rand with comma thousands in full groups of three: "1,249", "1,249.50". Nothing else with a comma. */
const GROUPED_RAND = /^\d{1,3}(,\d{3})+(\.\d{1,2})?$/;

/**
 * Rand as typed to whole cents: "R 1,249.50" is 124950. Blank is `undefined` (missing). A comma is
 * read only as a thousands separator in groups of three, so "12,50" is refused rather than read as
 * R1250. Anything else that is not rand with at most two decimals is `NaN`, which `checkQuote` refuses.
 */
export function parseRand(text: string): number | undefined {
  const t = text.trim().replace(/^r\s*/i, "");
  if (t === "") return undefined;
  if (!PLAIN_RAND.test(t) && !GROUPED_RAND.test(t)) return Number.NaN;
  const [rand, cents = ""] = t.replace(/,/g, "").split(".");
  return Number(rand) * 100 + Number(cents.padEnd(2, "0"));
}

/** A whole number as typed: "6" is 6. Blank is `undefined`; anything else is `NaN`. */
export function parseWhole(text: string): number | undefined {
  const t = text.trim();
  if (t === "") return undefined;
  return WHOLE.test(t) ? Number(t) : Number.NaN;
}

/** The input `addQuote` takes, from what the form holds. `checkQuote` decides what is missing. */
export function quoteInput(values: FormValues): unknown {
  return {
    order: values.order,
    supplier: values.supplier,
    lines: values.lines.map((line) => ({
      item: line.item,
      unit: line.unit,
      packSize: parseWhole(line.packSize),
      pricePerPackCents: parseRand(line.price),
    })),
    delivery: { feeCents: parseRand(values.feeText), days: parseWhole(values.daysText) },
  };
}

/** Whole cents as rand for people: 14990 is "R149.90". */
export function randText(cents: number): string {
  const c = Math.abs(Math.trunc(cents));
  return `R${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
}

/** Delivery terms in plain words: "R50.00, 2 days", "free, same day". */
export function deliveryText(delivery: {
  readonly feeCents: number;
  readonly days: number;
}): string {
  const fee = delivery.feeCents === 0 ? "free" : randText(delivery.feeCents);
  const days =
    delivery.days === 0 ? "same day" : delivery.days === 1 ? "1 day" : `${delivery.days} days`;
  return `${fee}, ${days}`;
}
