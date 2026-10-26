// `order.closed` (story 8.7): the order, and the scenario's optional figures; nothing else.
import { describe, expect, it } from "vite-plus/test";
import { PAYLOAD_VALIDATORS, type JsonObject } from "../src/index.js";

const shape = PAYLOAD_VALIDATORS["order.closed"];

describe("order.closed shape", () => {
  it("accepts the order alone, which is all a phone sends", () => {
    expect(shape({ order: "Bulk maize" })).toEqual([]);
  });

  it("accepts the scenario's figures", () => {
    const payload: JsonObject = {
      order: "o1",
      totalCostMinor: 418000,
      creditedBackMinor: 2000,
      members: [{ member: "m1", paidMinor: 85000, shareMinor: 83600, creditMinor: 1400 }],
    };
    expect(shape(payload)).toEqual([]);
  });

  it("refuses a missing order, an unknown field, and figures that are not whole cents", () => {
    expect(shape({}).length).toBeGreaterThan(0);
    expect(shape({ order: "o1", reason: "x" }).length).toBeGreaterThan(0);
    expect(shape({ order: "o1", totalCostMinor: 1.5 }).length).toBeGreaterThan(0);
    expect(shape({ order: "o1", members: "all" }).length).toBeGreaterThan(0);
  });
});
