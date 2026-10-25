import { describe, expect, it } from "vite-plus/test";

import { formatRand, summarise, week } from "./data";

describe("summarise", () => {
  it("totals revenue and orders over the period", () => {
    const summary = summarise(week);
    expect(summary.revenue).toBe(12080);
    expect(summary.orders).toBe(315);
  });

  it("compares the second half of the period with the first", () => {
    const days = [
      { day: "a", revenue: 100, orders: 10 },
      { day: "b", revenue: 100, orders: 10 },
      { day: "c", revenue: 150, orders: 5 },
      { day: "d", revenue: 150, orders: 5 },
    ];
    const summary = summarise(days);
    expect(summary.revenueTrend).toBeCloseTo(50);
    expect(summary.ordersTrend).toBeCloseTo(-50);
  });

  it("compares equal halves, leaving out the oldest day of an odd period", () => {
    const days = [
      { day: "old", revenue: 9999, orders: 999 },
      { day: "a", revenue: 100, orders: 10 },
      { day: "b", revenue: 100, orders: 10 },
      { day: "c", revenue: 200, orders: 10 },
      { day: "d", revenue: 200, orders: 10 },
    ];
    expect(summarise(days).revenueTrend).toBeCloseTo(100);
    expect(summarise(days).ordersTrend).toBeCloseTo(0);
  });

  it("reports no change rather than dividing by zero", () => {
    expect(summarise([]).revenueTrend).toBe(0);
    expect(summarise([{ day: "a", revenue: 5, orders: 1 }]).revenueTrend).toBe(0);
  });
});

describe("formatRand", () => {
  it.each([
    [0, "R 0"],
    [950, "R 950"],
    [12080, "R 12 080"],
    [1234567.4, "R 1 234 567"],
  ])("formats %d as %s", (amount, text) => {
    expect(formatRand(amount)).toBe(text);
  });
});
