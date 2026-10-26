import { checkQuote } from "@shopong/community";
import { describe, expect, it } from "vite-plus/test";

import {
  deliveryText,
  emptyLine,
  parseRand,
  parseWhole,
  quoteInput,
  randText,
  type FormValues,
  type LineDraft,
} from "./form";

const sugar: LineDraft = { item: "Sugar", unit: "kg", packSize: "10", price: "125.50" };

const full: FormValues = {
  order: "March groceries",
  supplier: "Mama Thandi Wholesale",
  lines: [sugar],
  feeText: "50",
  daysText: "2",
};

describe("parseRand", () => {
  it.each([
    ["125.50", 12550],
    ["R 1,249.5", 124950],
    ["0", 0],
    ["7", 700],
    ["125.5", 12550],
    ["R 1,249.50", 124950],
    ["1,249", 124900],
  ])("reads %s as %i cents", (text, cents) => {
    expect(parseRand(text)).toBe(cents);
  });

  it("reads blank as missing, and anything else that is not rand as not a number", () => {
    expect(parseRand("  ")).toBeUndefined();
    expect(parseRand("R")).toBeUndefined();
    expect(parseRand("12.345")).toBeNaN();
    expect(parseRand("abc")).toBeNaN();
    expect(parseRand("-5")).toBeNaN();
  });

  it("refuses a comma used as a decimal separator, instead of reading it as thousands", () => {
    expect(parseRand("12,50")).toBeNaN();
    expect(parseRand("1,2")).toBeNaN();
    expect(parseRand("1,25")).toBeNaN();
  });

  it("refuses spaces used as thousands separators and three decimals", () => {
    expect(parseRand("1 249.50")).toBeNaN();
    expect(parseRand("125.555")).toBeNaN();
  });
});

describe("parseWhole", () => {
  it("reads whole numbers, blank as missing, and the rest as not a number", () => {
    expect(parseWhole(" 6 ")).toBe(6);
    expect(parseWhole("")).toBeUndefined();
    expect(parseWhole("2.5")).toBeNaN();
  });
});

describe("quoteInput", () => {
  it("turns a complete form into a quote that checkQuote accepts", () => {
    const checked = checkQuote(quoteInput(full));
    expect(checked.ok).toBe(true);
    if (checked.ok) {
      expect(checked.value.lines[0]).toEqual({
        item: "Sugar",
        unit: "kg",
        packSize: 10,
        pricePerPackCents: 12550,
      });
      expect(checked.value.delivery).toEqual({ feeCents: 5000, days: 2 });
    }
  });

  it("names the item whose price is missing, in plain words", () => {
    const checked = checkQuote(quoteInput({ ...full, lines: [{ ...sugar, price: "" }] }));
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.problems).toEqual(["Line 1 (Sugar): price missing."]);
  });

  it("tells the person what a badly typed price looks like", () => {
    const checked = checkQuote(quoteInput({ ...full, lines: [{ ...sugar, price: "ten" }] }));
    if (!checked.ok)
      expect(checked.problems).toEqual(["Line 1 (Sugar): write the price like 125.50."]);
    expect(checked.ok).toBe(false);
  });

  it("refuses a blank form with every reason at once", () => {
    const checked = checkQuote(
      quoteInput({
        ...full,
        order: "",
        supplier: "",
        lines: [emptyLine()],
        feeText: "",
        daysText: "",
      }),
    );
    if (!checked.ok) expect(checked.problems.length).toBeGreaterThan(3);
    expect(checked.ok).toBe(false);
  });
});

describe("plain words", () => {
  it("shows rand for people", () => {
    expect(randText(14990)).toBe("R149.90");
    expect(randText(5)).toBe("R0.05");
    expect(randText(0)).toBe("R0.00");
  });

  it("describes delivery terms in plain words", () => {
    expect(deliveryText({ feeCents: 5000, days: 2 })).toBe("R50.00, 2 days");
    expect(deliveryText({ feeCents: 0, days: 0 })).toBe("free, same day");
    expect(deliveryText({ feeCents: 0, days: 1 })).toBe("free, 1 day");
  });
});
