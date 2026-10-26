import { describe, expect, it } from "vite-plus/test";
import type { Quote, QuoteLine } from "./quotes.js";
import { RANKING_RULE, RANKING_THRESHOLD_PERCENT, rankQuotes, type Wanted } from "./rank.js";

const sugar: Wanted = { item: "Sugar", quantity: 10 };

/** A complete quote for sugar: one line, a pack of 10 kg at `pack` cents, and the delivery terms. */
function sugarQuote(supplier: string, pack: number, feeCents = 0, days = 0): Quote {
  return {
    supplier,
    order: "March groceries",
    lines: [{ item: "Sugar", unit: "kg", packSize: 10, pricePerPackCents: pack }],
    delivery: { feeCents, days },
  };
}

function line(item: string, packSize: number, pricePerPackCents: number): QuoteLine {
  return { item, unit: "bag", packSize, pricePerPackCents };
}

function ok(result: ReturnType<typeof rankQuotes>) {
  if (!result.ok) throw new Error(`expected a ranking, got: ${result.problems.join(" | ")}`);
  return result.value;
}

describe("rankQuotes: the matrix", () => {
  it("clear winner: ranks 1, 2 and 3 with totals and margins, and a recommendation", () => {
    const quotes = [
      sugarQuote("Thandi Wholesale", 12500, 0, 0), // 12500
      sugarQuote("Sipho Cash and Carry", 13750, 0, 1), // 13750, 10% above the lowest
      {
        // Packs of 5 kg at R70.00: 10 kg is 2 packs (R140.00), plus a R5.00 fee.
        supplier: "Bongi Traders",
        order: "March groceries",
        lines: [line("Sugar", 5, 7000)],
        delivery: { feeCents: 500, days: 3 },
      },
    ];
    const value = ok(rankQuotes(quotes, [sugar]));
    expect(value.ranked.map((r) => [r.rank, r.supplier, r.totalCents])).toEqual([
      [1, "Thandi Wholesale", 12500],
      [2, "Sipho Cash and Carry", 13750],
      [3, "Bongi Traders", 14500],
    ]);
    expect(value.ranked[0]?.margin).toEqual({ cents: 1250, permille: 100 });
    expect(value.ranked[1]?.margin).toEqual({ cents: 750, permille: 54 });
    expect(value.ranked[2]?.margin).toBeUndefined();
    expect(value.ranked[0]?.delivery).toEqual({ feeCents: 0, days: 0 });
    expect(value.ranked[2]?.delivery).toEqual({ feeCents: 500, days: 3 });
    expect(value.recommendation).toEqual({ kind: "clear", supplier: "Thandi Wholesale" });
    expect(value.incomplete).toEqual([]);
  });

  it("too close: the lowest is within the threshold of the next, so no recommendation and ranks still shown", () => {
    const quotes = [
      sugarQuote("Thandi Wholesale", 12500),
      sugarQuote("Sipho Cash and Carry", 12800),
    ];
    const value = ok(rankQuotes(quotes, [sugar]));
    expect(value.ranked.map((r) => r.rank)).toEqual([1, 2]);
    expect(value.ranked[0]?.margin).toEqual({ cents: 300, permille: 24 });
    expect(value.recommendation).toEqual({ kind: "too_close" });
  });

  it("the threshold is inclusive at exactly 3% and exclusive just below it", () => {
    expect(RANKING_THRESHOLD_PERCENT).toBe(3);
    const exact = ok(
      rankQuotes([sugarQuote("A", 12500), sugarQuote("B", 12875)], [sugar]), // +375 is exactly 3%
    );
    expect(exact.recommendation).toEqual({ kind: "clear", supplier: "A" });
    const below = ok(
      rankQuotes([sugarQuote("A", 12500), sugarQuote("B", 12874)], [sugar]), // +374 is 2.99%
    );
    expect(below.recommendation).toEqual({ kind: "too_close" });
  });

  it("one quote: shown as the only option, with no margin and no recommendation", () => {
    const value = ok(rankQuotes([sugarQuote("Thandi Wholesale", 12500)], [sugar]));
    expect(value.ranked).toEqual([
      {
        rank: 1,
        supplier: "Thandi Wholesale",
        totalCents: 12500,
        delivery: { feeCents: 0, days: 0 },
        margin: undefined,
      },
    ]);
    expect(value.recommendation).toEqual({ kind: "only_one" });
  });

  it("incomplete: a quote missing a wanted item is listed with what is missing, and is not ranked", () => {
    const wanted: Wanted[] = [sugar, { item: "Maize meal", quantity: 2 }];
    const full = {
      supplier: "Thandi Wholesale",
      order: "March groceries",
      lines: [line("Sugar", 10, 12500), line("Maize meal", 1, 9900)],
      delivery: { feeCents: 0, days: 0 },
    };
    const partial = sugarQuote("Sipho Cash and Carry", 7000); // sugar only
    const value = ok(rankQuotes([partial, full], wanted));
    expect(value.ranked.map((r) => r.supplier)).toEqual(["Thandi Wholesale"]);
    expect(value.incomplete).toEqual([
      { supplier: "Sipho Cash and Carry", missing: ["Maize meal"] },
    ]);
    expect(value.recommendation).toEqual({ kind: "only_one" });
  });

  it("tie: equal totals are ordered by supplier id, and the result is no clear recommendation", () => {
    const value = ok(
      rankQuotes([sugarQuote("Zodwa Stores", 12500), sugarQuote("Abel Spaza", 12500)], [sugar]),
    );
    expect(value.ranked.map((r) => [r.rank, r.supplier, r.totalCents])).toEqual([
      [1, "Abel Spaza", 12500],
      [2, "Zodwa Stores", 12500],
    ]);
    expect(value.ranked[0]?.margin).toEqual({ cents: 0, permille: 0 });
    expect(value.recommendation).toEqual({ kind: "too_close" });
  });

  it("none: with no complete quotes, nothing is ranked and there is no recommendation", () => {
    const partial = sugarQuote("Sipho Cash and Carry", 7000);
    const value = ok(rankQuotes([partial], [sugar, { item: "Maize meal", quantity: 2 }]));
    expect(value.ranked).toEqual([]);
    expect(value.recommendation).toEqual({ kind: "none" });
  });

  it("none: with no quotes at all", () => {
    const value = ok(rankQuotes([], [sugar]));
    expect(value.ranked).toEqual([]);
    expect(value.incomplete).toEqual([]);
    expect(value.recommendation).toEqual({ kind: "none" });
  });

  it("order of input: the same quotes shuffled give an identical result", () => {
    const quotes = [
      sugarQuote("Thandi Wholesale", 12500, 0, 0),
      sugarQuote("Sipho Cash and Carry", 13750, 0, 1),
      sugarQuote("Bongi Traders", 7000, 500, 3),
      sugarQuote("Abel Spaza", 7000),
    ];
    const reversed = [...quotes].reverse();
    expect(rankQuotes(reversed, [sugar])).toEqual(rankQuotes(quotes, [sugar]));
  });
});

describe("rankQuotes: money in integer cents", () => {
  it("counts packs up: 7 units from packs of 5 is 2 packs", () => {
    const quote: Quote = {
      supplier: "Thandi Wholesale",
      order: "March groceries",
      lines: [line("Sugar", 5, 1000)],
      delivery: { feeCents: 1, days: 0 },
    };
    const value = ok(rankQuotes([quote], [{ item: "Sugar", quantity: 7 }]));
    expect(value.ranked[0]?.totalCents).toBe(2001);
  });

  it("adds the delivery fee once per supplier, and adds cents exactly", () => {
    const quotes = [
      sugarQuote("A", 1, 0, 0), // 1 cent for the pack, not 0.1 + 0.2 style error
      sugarQuote("B", 2, 1, 0),
    ];
    const value = ok(rankQuotes(quotes, [{ item: "Sugar", quantity: 10 }]));
    expect(value.ranked.map((r) => r.totalCents)).toEqual([1, 3]);
  });

  it("stays exact at the largest limits without overflowing", () => {
    const big: Quote = {
      supplier: "Big",
      order: "Large",
      lines: [line("Sugar", 1, 10_000_000)],
      delivery: { feeCents: 10_000_000, days: 0 },
    };
    const value = ok(rankQuotes([big], [{ item: "Sugar", quantity: 10_000 }]));
    expect(value.ranked[0]?.totalCents).toBe(10_000 * 10_000_000 + 10_000_000);
    expect(Number.isSafeInteger(value.ranked[0]?.totalCents)).toBe(true);
  });

  it("refuses a total that is not a safe integer rather than rounding it", () => {
    const huge: Quote = {
      supplier: "Huge",
      order: "Large",
      lines: [line("Sugar", 1, Number.MAX_SAFE_INTEGER)],
      delivery: { feeCents: Number.MAX_SAFE_INTEGER, days: 0 },
    };
    const result = rankQuotes([huge], [{ item: "Sugar", quantity: 10_000 }]);
    expect(result.ok).toBe(false);
  });

  it("chooses the cheapest of two lines for the same wanted item", () => {
    const quote: Quote = {
      supplier: "Thandi Wholesale",
      order: "March groceries",
      lines: [line("Sugar", 10, 15000), line("sugar", 5, 6000)],
      delivery: { feeCents: 0, days: 0 },
    };
    const value = ok(rankQuotes([quote], [{ item: "Sugar", quantity: 10 }]));
    expect(value.ranked[0]?.totalCents).toBe(12000);
  });
});

describe("rankQuotes: the wanted list is checked", () => {
  it.each([
    ["no items", [], "Add the items the order needs."],
    ["a blank item", [{ item: "  ", quantity: 1 }], "Name each item the order needs."],
    [
      "a zero quantity",
      [{ item: "Sugar", quantity: 0 }],
      "The quantity of Sugar must be a whole number, 1 or more.",
    ],
    [
      "a quantity over the limit",
      [{ item: "Sugar", quantity: 10_001 }],
      "The quantity of Sugar is too large. Use 10,000 or fewer.",
    ],
    [
      "a fraction",
      [{ item: "Sugar", quantity: 1.5 }],
      "The quantity of Sugar must be a whole number, 1 or more.",
    ],
    [
      "an item named twice",
      [sugar, { item: "sugar", quantity: 2 }],
      "Name each item once: Sugar is listed more than once.",
    ],
  ])("refuses %s with a plain reason", (_label, wanted, message) => {
    const result = rankQuotes([sugarQuote("Thandi Wholesale", 12500)], wanted);
    expect(result).toEqual({ ok: false, problems: [message] });
  });

  it("refuses two quotes from the same supplier", () => {
    const result = rankQuotes(
      [sugarQuote("Thandi Wholesale", 12500), sugarQuote("Thandi Wholesale", 11000)],
      [sugar],
    );
    expect(result).toEqual({
      ok: false,
      problems: ["Two quotes name the same supplier: Thandi Wholesale."],
    });
  });

  it("states the rule in plain words", () => {
    expect(RANKING_RULE).toBe(
      "Lowest total wins. If the next supplier is within 3% we don't pick one.",
    );
  });
});

describe("rankQuotes: shuffle property", () => {
  // A seeded generator, so a failure can be run again: the same seed always makes the same sets.
  function generator(seed: number) {
    let state = seed >>> 0;
    const next = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
    const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
    const shuffle = <T>(items: readonly T[]): T[] => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(0, i);
        [out[i], out[j]] = [out[j] as T, out[i] as T];
      }
      return out;
    };
    return { int, shuffle };
  }

  const items = ["Sugar", "Maize meal", "Cooking oil"];

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])(
    "seed %i: any shuffle of the quotes and of the wanted list gives the same result",
    (seed) => {
      const gen = generator(seed);
      const wanted: Wanted[] = items.slice(0, gen.int(1, 3)).map((item) => ({
        item,
        quantity: gen.int(1, 30),
      }));
      const quotes: Quote[] = Array.from({ length: gen.int(0, 6) }, (_, index) => ({
        supplier: `Supplier ${String.fromCharCode(65 + ((index * 7 + seed) % 26))}${index}`,
        order: "March groceries",
        lines: items
          .filter(() => gen.int(0, 3) > 0)
          .map((item) => line(item, gen.int(1, 12), gen.int(1, 20000))),
        delivery: { feeCents: gen.int(0, 5000), days: gen.int(0, 5) },
      }));
      const expected = rankQuotes(quotes, wanted);
      for (let round = 0; round < 5; round++) {
        expect(rankQuotes(gen.shuffle(quotes), gen.shuffle(wanted))).toEqual(expected);
      }
    },
  );
});

describe("rankQuotes: equal totals", () => {
  // Every order of four quotes, so the tie-break cannot depend on the input order.
  function permutations<T>(items: readonly T[]): T[][] {
    if (items.length <= 1) return [[...items]];
    return items.flatMap((item, index) =>
      permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [
        item,
        ...rest,
      ]),
    );
  }

  it("orders equal totals by supplier name under every input order, and never recommends one of them", () => {
    const quotes = [
      sugarQuote("Zodwa Stores", 12500),
      sugarQuote("Abel Spaza", 12500),
      sugarQuote("Mama Ncube", 12500),
      sugarQuote("Bongi", 12600),
    ];
    const expected = ok(rankQuotes(quotes, [sugar]));
    expect(expected.ranked.map((r) => [r.supplier, r.totalCents])).toEqual([
      ["Abel Spaza", 12500],
      ["Mama Ncube", 12500],
      ["Zodwa Stores", 12500],
      ["Bongi", 12600],
    ]);
    expect(expected.recommendation).toEqual({ kind: "too_close" });
    const orders = permutations(quotes);
    expect(orders).toHaveLength(24);
    for (const order of orders) {
      const value = ok(rankQuotes(order, [sugar]));
      expect(value).toEqual(expected);
      expect(value.recommendation.kind).not.toBe("clear");
    }
  });
});
