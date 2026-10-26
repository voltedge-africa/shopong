import { describe, expect, it } from "vite-plus/test";
import { stitchAmount } from "./amount.js";

describe("the amount in Stitch's decimal shape", () => {
  it("is built from integer minor units with integer arithmetic", () => {
    expect(stitchAmount(12550)).toBe("125.50");
    expect(stitchAmount(100)).toBe("1.00");
    expect(stitchAmount(5)).toBe("0.05");
    expect(stitchAmount(1)).toBe("0.01");
    expect(stitchAmount(0)).toBe("0.00");
    expect(stitchAmount(450000000)).toBe("4500000.00");
  });

  it("refuses anything that is not a non-negative safe integer", () => {
    expect(stitchAmount(10.5)).toBeUndefined();
    expect(stitchAmount(-100)).toBeUndefined();
    expect(stitchAmount(Number.NaN)).toBeUndefined();
    expect(stitchAmount(Number.MAX_SAFE_INTEGER + 2)).toBeUndefined();
  });
});
