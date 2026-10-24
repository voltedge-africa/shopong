import { describe, expect, it } from "vite-plus/test";
import { greet } from "./index.js";

describe("greet", () => {
  it("greets by name", () => {
    expect(greet("Shopong")).toBe("Sawubona, Shopong");
  });
});
