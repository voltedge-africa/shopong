import { describe, expect, it } from "vite-plus/test";
import { checkQuote, QUOTE_MESSAGES } from "./index.js";

const base = {
  supplier: "Mama Thandi Wholesale",
  order: "March groceries",
  lines: [{ item: "Sugar", unit: "kg", packSize: 10, pricePerPackCents: 12500 }],
  delivery: { feeCents: 5000, days: 2 },
};

const line = (over: Record<string, unknown>) => ({
  ...base,
  lines: [{ ...base.lines[0], ...over }],
});

function problemsOf(input: unknown): readonly string[] {
  const checked = checkQuote(input);
  return checked.ok ? [] : checked.problems;
}

describe("phone numbers in names (finding 2)", () => {
  it("refuses a phone number typed inside the supplier name", () => {
    expect(problemsOf({ ...base, supplier: "Mama Thandi 082 555 1234" })).toEqual([
      "Leave phone numbers out of the supplier name.",
    ]);
  });

  it("refuses a hyphenated number with brackets and a name after it", () => {
    expect(problemsOf({ ...base, supplier: "082-555-1234 (Sipho)" })).toEqual([
      "Leave phone numbers out of the supplier name.",
    ]);
  });

  it("refuses a phone number typed inside an item name", () => {
    expect(problemsOf(line({ item: "Sugar +27 82 555 1234" }))).toEqual([
      "Line 1: Leave phone numbers out of the item name.",
    ]);
  });

  it("still accepts a supplier with a short number and an item with a size", () => {
    expect(problemsOf({ ...base, supplier: "Spar 24" })).toEqual([]);
    expect(problemsOf(line({ item: "Cooking oil 750ml" }))).toEqual([]);
  });
});

describe("bounds on text and size (finding 4)", () => {
  it("refuses a name longer than 80 characters, and accepts exactly 80", () => {
    expect(problemsOf({ ...base, supplier: "A".repeat(80) })).toEqual([]);
    expect(problemsOf({ ...base, supplier: "A".repeat(81) })).toEqual([
      "Keep the supplier name to 80 characters or fewer.",
    ]);
    expect(problemsOf({ ...base, order: "B".repeat(81) })).toEqual([
      "Keep the order name to 80 characters or fewer.",
    ]);
    expect(problemsOf(line({ unit: "U".repeat(81) }))).toEqual([
      "Line 1 (Sugar): keep the unit to 80 characters or fewer.",
    ]);
  });

  it.each([
    ["a newline", "Thandi\nWholesale"],
    ["a NUL character", "Thandi\u0000Wholesale"],
    ["a tab", "Thandi\tWholesale"],
  ])("refuses a name with %s", (_, supplier) => {
    expect(problemsOf({ ...base, supplier })).toEqual([
      "The supplier name has a character that cannot be used. Type it again on one line.",
    ]);
  });

  it("refuses more than 50 items, and accepts exactly 50", () => {
    const fifty = Array.from({ length: 50 }, () => base.lines[0]);
    expect(problemsOf({ ...base, lines: fifty })).toEqual([]);
    expect(problemsOf({ ...base, lines: [...fifty, base.lines[0]] })).toEqual([
      "A quote can have at most 50 items.",
    ]);
  });
});

describe("limits on money and size (finding 5)", () => {
  it("accepts a price of exactly R100,000.00 and refuses one cent more", () => {
    expect(problemsOf(line({ pricePerPackCents: 10_000_000 }))).toEqual([]);
    expect(problemsOf(line({ pricePerPackCents: 10_000_001 }))).toEqual([
      "Line 1 (Sugar): the price must be R100,000.00 or less.",
    ]);
  });

  it("accepts a pack size of exactly 10,000 and refuses 10,001", () => {
    expect(problemsOf(line({ packSize: 10_000 }))).toEqual([]);
    expect(problemsOf(line({ packSize: 10_001 }))).toEqual([
      "Line 1 (Sugar): the pack size must be 10,000 or less.",
    ]);
  });

  it("accepts a delivery fee of exactly R100,000.00 and refuses one cent more", () => {
    expect(problemsOf({ ...base, delivery: { feeCents: 10_000_000, days: 2 } })).toEqual([]);
    expect(problemsOf({ ...base, delivery: { feeCents: 10_000_001, days: 2 } })).toEqual([
      QUOTE_MESSAGES.delivery_fee_max,
    ]);
  });

  it("accepts 90 delivery days and refuses 91", () => {
    expect(problemsOf({ ...base, delivery: { feeCents: 0, days: 90 } })).toEqual([]);
    expect(problemsOf({ ...base, delivery: { feeCents: 0, days: 91 } })).toEqual([
      QUOTE_MESSAGES.delivery_days_max,
    ]);
  });
});

describe("spaces in names (finding 6)", () => {
  it("folds runs of spaces inside a supplier name to one space", () => {
    const checked = checkQuote({ ...base, supplier: "  Thandi   Wholesale " });
    expect(checked.ok).toBe(true);
    if (checked.ok) expect(checked.value.supplier).toBe("Thandi Wholesale");
  });
});
