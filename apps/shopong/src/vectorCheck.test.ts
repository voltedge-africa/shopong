import { describe, expect, it } from "vite-plus/test";
import { webCryptoSha512 } from "@shopong/events";

import { runGoldenVectors } from "./vectorCheck";

describe("runGoldenVectors", () => {
  it("passes every golden vector with a correct SHA-512", async () => {
    const report = await runGoldenVectors(webCryptoSha512);
    expect(report.failures).toEqual([]);
    expect(report.total).toBeGreaterThan(40);
    expect(report.passed).toBe(report.total);
  });

  it("fails loudly when the SHA-512 is wrong", async () => {
    const wrong = async (bytes: Uint8Array) => (await webCryptoSha512(bytes)).map((b) => b ^ 1);
    const report = await runGoldenVectors(wrong);
    expect(report.passed).toBeLessThan(report.total);
    expect(report.failures.some((f) => f.group === "events.accept")).toBe(true);
  });
});
