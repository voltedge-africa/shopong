import { describe, expect, it } from "vite-plus/test";
import { cameBackOnline } from "./connectivity";

describe("the reconnect try (review P9)", () => {
  it("counts only a change from offline to online", () => {
    expect(cameBackOnline(true, false)).toBe(true);
    expect(cameBackOnline(false, false)).toBe(false);
    expect(cameBackOnline(false, true)).toBe(false);
    expect(cameBackOnline(true, true)).toBe(false);
  });
});
