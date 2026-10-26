// Story 8.7 scenario check: the figures the closing screen works out (`closeFigures`, `@shopong/community`) match what the
// scripted order's close step wrote, member by member, and the screen's words never say money was paid back.
import { closeFigures, randText } from "@shopong/community";
import { webCryptoSha512 } from "@shopong/events";
import { describe, expect, it } from "vite-plus/test";
import { createStokvelScenario } from "../src/index.js";

describe("the closing screen against the scripted order", () => {
  it("works out the same share and credit for every member as the close step recorded", async () => {
    const scenario = createStokvelScenario({ sha512: webCryptoSha512 });
    const snapshot = await scenario.runAll();
    const books = await scenario.reconcile();
    expect(snapshot.summary).toBeDefined();
    const total = snapshot.funding.targetMinor as number;
    const screen = closeFigures(
      total,
      books.members.map((m) => m.paidMinor),
    );
    expect(screen).toHaveLength(books.members.length);
    books.members.forEach((row, i) => {
      expect(screen[i]?.shareMinor, `${row.key} share`).toBe(row.shareMinor);
      // Credit in the books equals what the screen calls credit, still in the pool.
      const credit = screen[i]?.difference.kind === "credit" ? screen[i].difference.minor : 0;
      expect(credit, `${row.key} credit`).toBe(row.creditMinor);
    });
    // The snapshot's own totals agree with the screen's.
    expect(snapshot.summary?.totalCostText.replace(/\s/g, "")).toBe(
      randText(BigInt(total)).replace(/\s/g, ""),
    );
    const credits = screen.reduce((sum, row) => sum + row.difference.minor, 0);
    expect(snapshot.summary?.creditedBackText.replace(/\s/g, "")).toBe(
      randText(BigInt(credits)).replace(/\s/g, ""),
    );
    // The screen never says a payment was paid back or refunded.
    expect(JSON.stringify(screen).toLowerCase()).not.toContain("refund");
    expect(books.ok).toBe(true);
  });
});
