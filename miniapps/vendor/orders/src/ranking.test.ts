import { RANKING_RULE, rankQuotes, type Quote, type Ranking } from "@shopong/community";
import { describe, expect, it } from "vite-plus/test";

import { describeRanking, orderRanking, wantedFromDrafts, type WantDraft } from "./ranking";

const sugar = { item: "Sugar", unit: "kg", packSize: 10, pricePerPackCents: 12500 };
const MARCH = "March groceries";

function quoteFor(order: string, supplier: string, pack: number, feeCents = 0, days = 0): Quote {
  return {
    supplier,
    order,
    lines: [{ ...sugar, pricePerPackCents: pack }],
    delivery: { feeCents, days },
  };
}

function quote(supplier: string, pack: number, feeCents = 0, days = 0): Quote {
  return quoteFor(MARCH, supplier, pack, feeCents, days);
}

function ranked(quotes: readonly Quote[], wanted = [{ item: "Sugar", quantity: 10 }]): Ranking {
  const result = rankQuotes(quotes, wanted);
  if (!result.ok) throw new Error(result.problems.join(" | "));
  return result.value;
}

const SUGAR_ONLY: WantDraft[] = [{ item: "Sugar", quantity: "10" }];

describe("wantedFromDrafts", () => {
  it("drops rows the treasurer left blank, and reads quantities as whole numbers", () => {
    const drafts: WantDraft[] = [
      { item: " Sugar ", quantity: "10" },
      { item: "", quantity: "" },
      { item: "Maize meal", quantity: "2" },
    ];
    expect(wantedFromDrafts(drafts)).toEqual([
      { item: " Sugar ", quantity: 10 },
      { item: "Maize meal", quantity: 2 },
    ]);
  });

  it("passes a bad or missing quantity on as not a number, so the ranking says what to fix", () => {
    const [row] = wantedFromDrafts([{ item: "Sugar", quantity: "1.5" }]);
    expect(row?.quantity).toBeNaN();
    const [blank] = wantedFromDrafts([{ item: "Sugar", quantity: " " }]);
    expect(blank?.quantity).toBeNaN();
  });

  it("leaves the ranking to say so when nothing is wanted", () => {
    expect(wantedFromDrafts([{ item: " ", quantity: "" }])).toEqual([]);
    expect(orderRanking([quote("A", 12500)], [{ item: "", quantity: "" }], MARCH)).toEqual({
      ok: false,
      problems: ["Add the items the order needs."],
    });
  });

  it("returns the plain view when the wanted items can be ranked", () => {
    const result = orderRanking([quote("Thandi Wholesale", 12500)], SUGAR_ONLY, MARCH);
    expect(result.ok && result.view.rows.map((row) => row.supplier)).toEqual(["Thandi Wholesale"]);
  });
});

describe("orderRanking: quantities as typed", () => {
  const notWhole =
    "The quantity of Sugar must be a whole number. Write the number without commas or spaces, for example 1000.";

  it.each([["1,000"], ["1 000"], ["1.5"], ["x"]])(
    "says how to write %s when it is not digits only",
    (typed) => {
      expect(orderRanking([quote("A", 1)], [{ item: "Sugar", quantity: typed }], MARCH)).toEqual({
        ok: false,
        problems: [notWhole],
      });
    },
  );

  it("says a quantity over the limit is too large, and the most it may be", () => {
    expect(orderRanking([quote("A", 1)], [{ item: "Sugar", quantity: "10001" }], MARCH)).toEqual({
      ok: false,
      problems: ["The quantity of Sugar is too large. Use 10,000 or fewer."],
    });
  });

  it("returns the text problems in a stable order, whatever the order of the rows", () => {
    const rows: WantDraft[] = [
      { item: "Sugar", quantity: "1.5" },
      { item: "Maize meal", quantity: "x" },
    ];
    const forward = orderRanking([quote("A", 1)], rows, MARCH);
    const backward = orderRanking([quote("A", 1)], [...rows].reverse(), MARCH);
    expect(backward).toEqual(forward);
    expect(forward.ok ? [] : forward.problems[0]).toBe(
      "The quantity of Maize meal must be a whole number. Write the number without commas or spaces, for example 1000.",
    );
  });
});

describe("orderRanking: the quotes for this order only", () => {
  it("never ranks a quote from another order", () => {
    const quotes = [
      quoteFor(MARCH, "Thandi Wholesale", 12500),
      quoteFor("April stock", "Sipho", 1000),
    ];
    const march = orderRanking(quotes, SUGAR_ONLY, MARCH);
    expect(march.ok && march.view.rows.map((row) => row.supplier)).toEqual(["Thandi Wholesale"]);
    const april = orderRanking(quotes, SUGAR_ONLY, "April stock");
    expect(april.ok && april.view.rows.map((row) => row.supplier)).toEqual(["Sipho"]);
  });

  it("matches the order name after tidying its spaces", () => {
    const quotes = [quoteFor(MARCH, "Thandi Wholesale", 12500)];
    const result = orderRanking(quotes, SUGAR_ONLY, "  March   groceries ");
    expect(result.ok && result.view.rows.map((row) => row.supplier)).toEqual(["Thandi Wholesale"]);
  });
});

describe("orderRanking: the card says what it was ranked for", () => {
  it("echoes the wanted items and quantities in the order they were typed", () => {
    const drafts: WantDraft[] = [
      { item: "Sugar", quantity: "10" },
      { item: " Maize  meal ", quantity: "2" },
    ];
    const complete: Quote = {
      supplier: "Thandi Wholesale",
      order: MARCH,
      lines: [sugar, { item: "Maize meal", unit: "bag", packSize: 1, pricePerPackCents: 9900 }],
      delivery: { feeCents: 0, days: 0 },
    };
    const result = orderRanking([complete], drafts, MARCH);
    expect(result.ok && result.view.rankedFor).toBe("Sugar 10, Maize meal 2");
  });
});

describe("describeRanking", () => {
  it("states the rule in plain words", () => {
    expect(describeRanking(ranked([quote("A", 12500)])).rule).toBe(RANKING_RULE);
    expect(RANKING_RULE).toBe(
      "Lowest total wins. If the next supplier is within 3% we don't pick one.",
    );
  });

  it("clear winner: the headline names the lowest, and each row says what it costs and what it is cheaper by", () => {
    const view = describeRanking(
      ranked([quote("Thandi Wholesale", 12500, 0, 0), quote("Sipho Cash and Carry", 13750, 0, 1)]),
    );
    expect(view.headline).toBe(
      "Lowest total: Thandi Wholesale. The next supplier costs at least 3% more.",
    );
    expect(view.rows).toEqual([
      {
        rank: 1,
        supplier: "Thandi Wholesale",
        total: "R125.00",
        delivery: "free, same day",
        next: "R12.50 cheaper than the next supplier (the next one costs 10.0% more)",
      },
      {
        rank: 2,
        supplier: "Sipho Cash and Carry",
        total: "R137.50",
        delivery: "free, 1 day",
        next: undefined,
      },
    ]);
    expect(view.cannotCompare).toEqual([]);
  });

  it("too close: says there is no clear recommendation, and still shows the ranks", () => {
    const view = describeRanking(ranked([quote("Thandi Wholesale", 12500), quote("Sipho", 12800)]));
    expect(view.headline).toBe(
      "No clear recommendation. The next supplier is within 3%, so we don't pick one.",
    );
    expect(view.rows.map((row) => row.rank)).toEqual([1, 2]);
    expect(view.rows[0]?.next).toBe(
      "R3.00 cheaper than the next supplier (the next one costs 2.4% more)",
    );
  });

  it("a one-cent margin on R125.00 reads as less than 0.1% more, never 0.0%", () => {
    const view = describeRanking(ranked([quote("Thandi Wholesale", 12500), quote("Sipho", 12501)]));
    expect(view.rows[0]?.next).toBe(
      "R0.01 cheaper than the next supplier (the next one costs less than 0.1% more)",
    );
  });

  it("tie: the headline says the two lowest totals are the same, and the margin is the same total", () => {
    const view = describeRanking(
      ranked([quote("Zodwa Stores", 12500), quote("Abel Spaza", 12500)]),
    );
    expect(view.headline).toBe("No clear recommendation. The two lowest totals are the same.");
    expect(view.rows.map((row) => row.supplier)).toEqual(["Abel Spaza", "Zodwa Stores"]);
    expect(view.rows[0]?.next).toBe("Same total as the next supplier.");
  });

  it("one quote: the only option, with no margin", () => {
    const view = describeRanking(ranked([quote("Thandi Wholesale", 12500)]));
    expect(view.headline).toBe("Only one quote, so there is nothing to compare it with yet.");
    expect(view.rows).toEqual([
      {
        rank: 1,
        supplier: "Thandi Wholesale",
        total: "R125.00",
        delivery: "free, same day",
        next: undefined,
      },
    ]);
  });

  it("one complete quote with others incomplete: says only one can be compared so far", () => {
    const complete = quote("Thandi Wholesale", 12500);
    const empty: Quote = {
      supplier: "Sipho",
      order: MARCH,
      lines: [],
      delivery: { feeCents: 0, days: 0 },
    };
    const view = describeRanking(ranked([complete, empty]));
    expect(view.headline).toBe("Only one quote can be compared so far.");
    expect(view.cannotCompare).toEqual(["Can't compare Sipho: missing Sugar."]);
  });

  it("none: says there are no quotes to compare yet", () => {
    const view = describeRanking(ranked([]));
    expect(view.headline).toBe("No quotes to compare yet.");
    expect(view.rows).toEqual([]);
  });

  it("lists an incomplete quote under can't compare, with what is missing, and not among the rows", () => {
    const complete: Quote = {
      supplier: "Thandi Wholesale",
      order: MARCH,
      lines: [sugar, { item: "Maize meal", unit: "bag", packSize: 1, pricePerPackCents: 9900 }],
      delivery: { feeCents: 0, days: 0 },
    };
    const empty: Quote = {
      supplier: "Sipho",
      order: MARCH,
      lines: [],
      delivery: { feeCents: 0, days: 0 },
    };
    const view = describeRanking(
      ranked(
        [complete, empty],
        [
          { item: "Sugar", quantity: 10 },
          { item: "Maize meal", quantity: 2 },
        ],
      ),
    );
    expect(view.rows.map((row) => row.supplier)).toEqual(["Thandi Wholesale"]);
    expect(view.cannotCompare).toEqual(["Can't compare Sipho: missing Maize meal and Sugar."]);
  });

  it("writes large rand amounts with thousands separators and whole cents", () => {
    const view = describeRanking(
      ranked(
        [quote("Big", 1_249_500), quote("Bigger", 1_249_501)],
        [{ item: "Sugar", quantity: 10 }],
      ),
    );
    expect(view.rows[0]?.total).toBe("R12,495.00");
    expect(view.rows[0]?.next).toBe(
      "R0.01 cheaper than the next supplier (the next one costs less than 0.1% more)",
    );
  });
});
