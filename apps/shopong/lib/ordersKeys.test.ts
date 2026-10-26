// Sibling panels in the orders screen have distinct React keys (review patch 2: two panels keyed by the order name made
// React warn about duplicate keys on web). Checked against the source, so a new sibling key collision fails here.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

describe("orders screen keys", () => {
  it("keys the pay panel and the files panel by different names for the same order", () => {
    const source = readFileSync(
      new URL("../../../miniapps/vendor/orders/src/Orders.tsx", import.meta.url),
      "utf8",
    );
    const keys = [...source.matchAll(/<(PayPanel|FilesPanel)\s+key=\{(`[^`]*`)\}/g)].map((m) => [
      m[1],
      m[2],
    ]);
    expect(keys).toEqual([
      ["PayPanel", "`pay-${name}`"],
      ["FilesPanel", "`files-${name}`"],
    ]);
  });
});
