import { describe, expect, it } from "vite-plus/test";

import { themeFor } from "./theme";

describe("themeFor", () => {
  it("returns the dark theme for dark", () => {
    expect(themeFor("dark").background).toBe("#0b1220");
  });

  it("falls back to light for light, null and undefined", () => {
    expect(themeFor("light")).toBe(themeFor(null));
    expect(themeFor(undefined).background).toBe("#ffffff");
  });
});
