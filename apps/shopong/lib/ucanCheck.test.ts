import { describe, expect, it, vi } from "vite-plus/test";

// Node already has everything the polyfills would add, and expo-crypto needs the Expo runtime.
vi.mock("./cryptoPolyfills", () => ({ installedPolyfills: [] }));

import { runUcanCheck } from "./ucanCheck";

describe("runUcanCheck", () => {
  it("passes every case against the iso-ucan adapter", async () => {
    const report = await runUcanCheck();
    const failures = report.cases.filter((c) => !c.pass);
    expect(failures).toEqual([]);
    expect(report.passed).toBe(report.cases.length);
    expect(report.cases.length).toBeGreaterThanOrEqual(8);
  });
});
