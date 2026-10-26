import { rankQuotes, type Quote, type Selection, type Wanted } from "@shopong/community";
import { describe, expect, it } from "vite-plus/test";

import { cellOf, comparisonOf } from "./compare";

const wanted: Wanted[] = [
  { item: "Cooking oil", quantity: 12 },
  { item: "Maize meal", quantity: 4 },
];

// Thandi: 12 oil from packs of 6 = 2 packs of R149.90 = R299.80; maize 4 x R99.00 = R396.00; fee R50.00. Total R745.80.
const thandi: Quote = {
  supplier: "Mama Thandi Wholesale",
  order: "April groceries",
  lines: [
    { item: "Cooking oil", unit: "bottle", packSize: 6, pricePerPackCents: 14_990 },
    { item: "Maize meal", unit: "bag", packSize: 1, pricePerPackCents: 9_900 },
  ],
  delivery: { feeCents: 5_000, days: 2 },
};
// Shop Two: 12 oil from packs of 12 = 1 pack of R300.00; maize 4 from packs of 5 = 1 pack of R400.00; free delivery. Total R700.00.
const shopTwo: Quote = {
  supplier: "Shop Two",
  order: "April groceries",
  lines: [
    { item: "Cooking oil", unit: "bottle", packSize: 12, pricePerPackCents: 30_000 },
    { item: "Maize meal", unit: "bag", packSize: 5, pricePerPackCents: 40_000 },
  ],
  delivery: { feeCents: 0, days: 5 },
};
// Half Shop names only the oil: it cannot be ranked.
const halfShop: Quote = {
  supplier: "Half Shop",
  order: "April groceries",
  lines: [{ item: "Cooking oil", unit: "bottle", packSize: 1, pricePerPackCents: 2_000 }],
  delivery: { feeCents: 0, days: 0 },
};

const ranking = (quotes: readonly Quote[]) => {
  const result = rankQuotes(quotes, wanted);
  if (!result.ok) throw new Error(result.problems.join(" "));
  return result.value;
};

const chosen = (supplier: string, totalMinor: number): Selection => ({
  order: "April groceries",
  supplier,
  totalMinor,
  by: "did:key:treasurer",
  eventId: "ab".repeat(64),
});

describe("the cell for one item and supplier", () => {
  it("counts packs up and takes the cheapest line that names the item", () => {
    expect(cellOf(thandi, wanted[0]!)).toEqual({
      cost: "R299.80",
      detail: "2 packs of 6 bottle at R149.90",
    });
  });

  it("uses the singular for one pack and says so when the quote lacks the item", () => {
    expect(cellOf(shopTwo, wanted[0]!)).toEqual({
      cost: "R300.00",
      detail: "1 pack of 12 bottle at R300.00",
    });
    expect(cellOf(halfShop, wanted[1]!)).toEqual({ detail: "Not on this quote" });
  });

  it("matches item names ignoring case, as the ranking does", () => {
    const shouting: Quote = {
      ...halfShop,
      lines: [{ item: "COOKING OIL", unit: "bottle", packSize: 12, pricePerPackCents: 30_000 }],
    };
    expect(cellOf(shouting, wanted[0]!).cost).toBe("R300.00");
  });
});

describe("the comparison table", () => {
  it("lists the items down the side and the ranked suppliers across, lowest first", () => {
    const view = comparisonOf({
      quotes: [thandi, shopTwo],
      wanted,
      ranking: ranking([thandi, shopTwo]),
      chosen: undefined,
      canChoose: true,
    });
    expect(view.items).toEqual(["Cooking oil, 12 units", "Maize meal, 4 units"]);
    expect(view.columns.map((c) => c.supplier)).toEqual(["Shop Two", "Mama Thandi Wholesale"]);
    const [first, second] = view.columns;
    expect(first).toMatchObject({
      rank: 1,
      total: "R700.00",
      delivery: "free, 5 days",
      canChoose: true,
      chosen: false,
    });
    expect(first?.cells.map((cell) => cell.cost)).toEqual(["R300.00", "R400.00"]);
    expect(second).toMatchObject({ rank: 2, total: "R745.80", delivery: "R50.00, 2 days" });
    expect(second?.cells.map((cell) => cell.cost)).toEqual(["R299.80", "R396.00"]);
  });

  it("shows a quote that misses an item last, with what is missing, and no choice for it", () => {
    const view = comparisonOf({
      quotes: [thandi, shopTwo, halfShop],
      wanted,
      ranking: ranking([thandi, shopTwo, halfShop]),
      chosen: undefined,
      canChoose: true,
    });
    const last = view.columns[view.columns.length - 1];
    expect(last).toMatchObject({
      supplier: "Half Shop",
      note: "Can't be compared: missing Maize meal.",
      canChoose: false,
    });
    expect(last?.rank).toBeUndefined();
    expect(last?.total).toBeUndefined();
    expect(last?.cells[1]).toEqual({ detail: "Not on this quote" });
  });

  it("marks the chosen supplier and says what the choice means, in plain words", () => {
    const view = comparisonOf({
      quotes: [thandi, shopTwo],
      wanted,
      ranking: ranking([thandi, shopTwo]),
      chosen: chosen("Mama Thandi Wholesale", 74_580),
      canChoose: true,
    });
    expect(view.columns.find((c) => c.chosen)?.supplier).toBe("Mama Thandi Wholesale");
    expect(view.chosenText).toBe(
      "Chosen: Mama Thandi Wholesale, R745.80. That total is the pool's target.",
    );
  });

  it("gives a member no button to choose, and no choice sentence when nothing is chosen", () => {
    const view = comparisonOf({
      quotes: [thandi, shopTwo],
      wanted,
      ranking: ranking([thandi, shopTwo]),
      chosen: undefined,
      canChoose: false,
    });
    expect(view.columns.every((c) => !c.canChoose)).toBe(true);
    expect(view.chosenText).toBeUndefined();
  });

  it("lists every quote by name, with no totals, when the needs cannot be ranked", () => {
    const view = comparisonOf({
      quotes: [shopTwo, thandi],
      wanted,
      ranking: undefined,
      chosen: undefined,
      canChoose: true,
    });
    expect(view.columns.map((c) => c.supplier)).toEqual(["Mama Thandi Wholesale", "Shop Two"]);
    expect(view.columns.every((c) => c.total === undefined && !c.canChoose)).toBe(true);
    expect(view.columns.every((c) => c.note === "Not ranked yet.")).toBe(true);
  });
});
