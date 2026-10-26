import { checkQuote } from "@shopong/community";
import { describe, expect, it } from "vite-plus/test";

import {
  deadlineOf,
  deadlineText,
  deliveryText,
  emptyLine,
  parseRand,
  proposalInput,
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

  it("groups rand in thousands, for people to read", () => {
    expect(randText(99_999)).toBe("R999.99");
    expect(randText(100_000)).toBe("R1,000.00");
    expect(randText(124_950_000)).toBe("R1,249,500.00");
  });

  it("describes delivery terms in plain words", () => {
    expect(deliveryText({ feeCents: 5000, days: 2 })).toBe("R50.00, 2 days");
    expect(deliveryText({ feeCents: 0, days: 0 })).toBe("free, same day");
    expect(deliveryText({ feeCents: 0, days: 1 })).toBe("free, 1 day");
  });
});

describe("deadlineOf", () => {
  it("reads a date as the end of that day in South Africa (UTC+2)", () => {
    expect(deadlineOf("2026-11-30")).toBe(Date.UTC(2026, 10, 30, 21, 59, 59, 999));
    expect(deadlineOf(" 2026-11-30 ")).toBe(Date.UTC(2026, 10, 30, 21, 59, 59, 999));
  });

  it("is undefined when blank, and NaN for anything that is not a real date", () => {
    expect(deadlineOf("  ")).toBeUndefined();
    expect(deadlineOf("2026-02-30")).toBeNaN();
    expect(deadlineOf("30/11/2026")).toBeNaN();
    expect(deadlineOf("2026-13-01")).toBeNaN();
  });
});

describe("deadlineText", () => {
  it("says the date in plain words, in South Africa time", () => {
    expect(deadlineText(Date.UTC(2026, 10, 30, 21, 59, 59, 999))).toBe("30 November 2026");
    expect(deadlineText(Date.UTC(2026, 0, 1, 0, 0, 0, 0))).toBe("1 January 2026");
  });
});

describe("proposalInput", () => {
  it("is the input the record checks: the typed name, the needed items, the budget and the deadline", () => {
    expect(
      proposalInput({
        name: "April groceries",
        wants: [
          { item: "Cooking oil", quantity: "12" },
          { item: "", quantity: "" },
        ],
        budgetText: "R500",
        deadlineText: "2026-11-30",
      }),
    ).toEqual({
      name: "April groceries",
      items: [{ item: "Cooking oil", quantity: 12 }],
      budgetPerMemberMinor: 50_000,
      deadline: Date.UTC(2026, 10, 30, 21, 59, 59, 999),
    });
  });

  it("leaves a missing budget or deadline blank, and a mistyped quantity as NaN", () => {
    expect(
      proposalInput({
        name: "April groceries",
        wants: [{ item: "Cooking oil", quantity: "x" }],
        budgetText: "",
        deadlineText: "",
      }),
    ).toEqual({
      name: "April groceries",
      items: [{ item: "Cooking oil", quantity: Number.NaN }],
      budgetPerMemberMinor: undefined,
      deadline: undefined,
    });
  });
});
