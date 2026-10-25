import { describe, expect, it } from "vite-plus/test";

import {
  CARDS,
  SEND_AMOUNT,
  TOP_UP_AMOUNT,
  TRANSACTIONS,
  canSend,
  hideTransaction,
  initialWallet,
  money,
  moveMoney,
  noise,
  spending,
  splitTransaction,
  totalBalance,
} from "./data";

describe("money", () => {
  it.each([
    [0, "R 0.00"],
    [38.6, "R 38.60"],
    [1234.5, "R 1 234.50"],
    [12_850, "R 12 850.00"],
    [1_234_567.891, "R 1 234 567.89"],
    [-1234.5, "−R 1 234.50"],
  ])("writes %d as %s", (value, text) => {
    expect(money(value)).toBe(text);
  });

  it("puts a plus on money in only when asked", () => {
    expect(money(120, true)).toBe("+R 120.00");
    expect(money(120)).toBe("R 120.00");
    expect(money(-120, true)).toBe("−R 120.00");
    expect(money(0, true)).toBe("R 0.00");
  });
});

describe("noise", () => {
  it("is the same for the same key and stays between 0 and 1", () => {
    expect(noise("a")).toBe(noise("a"));
    expect(noise("a")).not.toBe(noise("b"));
    for (const key of ["", "x", "everyday:m3", "savings:y11"]) {
      expect(noise(key)).toBeGreaterThanOrEqual(0);
      expect(noise(key)).toBeLessThanOrEqual(1);
    }
  });
});

describe("spending", () => {
  const card = CARDS[0]!;

  it.each([
    ["week", 7, "Mon", "Sun"],
    ["month", 30, "1", "30"],
    ["year", 12, "Jan", "Dec"],
  ] as const)("covers a %s with %d points", (range, count, first, last) => {
    const points = spending(card, range);
    expect(points).toHaveLength(count);
    expect(points[0]?.label).toBe(first);
    expect(points.at(-1)?.label).toBe(last);
  });

  it("is a running total, so it never goes down", () => {
    for (const range of ["week", "month", "year"] as const) {
      const spent = spending(card, range).map((point) => point.spent);
      expect(spent).toEqual([...spent].sort((a, b) => a - b));
    }
  });

  it("draws the same chart every time, and a quieter card spends less", () => {
    expect(spending(card, "month")).toEqual(spending(card, "month"));
    const savings = CARDS.find((item) => item.id === "savings")!;
    expect(spending(savings, "month").at(-1)!.spent).toBeLessThan(
      spending(card, "month").at(-1)!.spent,
    );
  });
});

describe("the wallet", () => {
  it("adds the cards up", () => {
    expect(totalBalance(CARDS)).toBeCloseTo(12_480.36, 2);
  });

  it("tops up one card, records it first and leaves the other cards alone", () => {
    const next = moveMoney(initialWallet(), "everyday", TOP_UP_AMOUNT, {
      title: "Top-up",
      detail: "From your bank",
      when: "Just now",
    });
    expect(next.cards.find((card) => card.id === "everyday")?.balance).toBeCloseTo(4240.18, 2);
    expect(next.cards.find((card) => card.id === "savings")?.balance).toBe(8053.78);
    expect(next.transactions[0]).toMatchObject({
      id: "new-1",
      amount: TOP_UP_AMOUNT,
      title: "Top-up",
    });
    expect(next.transactions).toHaveLength(TRANSACTIONS.length + 1);
  });

  it("gives each new entry its own id and does not change the state it was given", () => {
    const start = initialWallet();
    const once = moveMoney(start, "everyday", -SEND_AMOUNT, {
      title: "Lindiwe Zulu",
      detail: "Sent",
      when: "Just now",
    });
    const twice = moveMoney(once, "everyday", -SEND_AMOUNT, {
      title: "Lindiwe Zulu",
      detail: "Sent",
      when: "Just now",
    });
    expect(twice.transactions.slice(0, 2).map((row) => row.id)).toEqual(["new-2", "new-1"]);
    expect(start.cards).toBe(CARDS);
    expect(start.transactions).toHaveLength(TRANSACTIONS.length);
  });

  it("does not drift when sending cents", () => {
    let state = initialWallet();
    for (let count = 0; count < 3; count += 1)
      state = moveMoney(state, "everyday", -0.1, { title: "x", detail: "x", when: "x" });
    expect(state.cards[0]!.balance).toBe(3239.88);
  });

  it("only lets a card send when it is not frozen and has the money", () => {
    const [everyday] = CARDS;
    expect(canSend(everyday!, false)).toBe(true);
    expect(canSend(everyday!, true)).toBe(false);
    expect(canSend({ ...everyday!, balance: SEND_AMOUNT - 0.01 }, false)).toBe(false);
    expect(canSend({ ...everyday!, balance: SEND_AMOUNT }, false)).toBe(true);
  });

  it("splits a payment in two, once, and never money in", () => {
    const out = TRANSACTIONS.find((row) => row.amount < 0)!;
    const inbound = TRANSACTIONS.find((row) => row.amount > 0)!;
    const split = splitTransaction(initialWallet(), out.id);
    const row = split.transactions.find((item) => item.id === out.id)!;
    expect(row).toMatchObject({ amount: out.amount / 2, split: true });
    expect(splitTransaction(split, out.id)).toEqual(split);
    expect(splitTransaction(initialWallet(), inbound.id)).toEqual(initialWallet());
  });

  it("hides a row and ignores an unknown id", () => {
    const hidden = hideTransaction(initialWallet(), "t1");
    expect(hidden.transactions.map((row) => row.id)).not.toContain("t1");
    expect(hidden.transactions).toHaveLength(TRANSACTIONS.length - 1);
    expect(hideTransaction(initialWallet(), "nope")).toEqual(initialWallet());
  });
});
