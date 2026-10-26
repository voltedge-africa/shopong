// The reconciler's schedule (story 4.5): one run at start, then one on each interval, each logged as simulated.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { DiscrepancyStore } from "./discrepancies.ts";
import { CheckingStore, type CheckingStore as Store } from "./payment-confirmation.ts";
import { startChecking, type ReconcilerDeps } from "./reconciler.ts";

const folder = mkdtempSync(join(tmpdir(), "ocn-reconciler-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

describe("the reconciler's schedule (simulated)", () => {
  it("runs once at start and again on each interval, and logs each run as simulated", async () => {
    const lines: string[] = [];
    const store: Store = new CheckingStore(join(folder, "schedule.json"));
    const deps: ReconcilerDeps = {
      simulated: { payIn: { requests: () => [] } } as unknown as ReconcilerDeps["simulated"],
      ledger: {} as ReconcilerDeps["ledger"],
      hub: {
        heldCommunities: () => [],
        journalOf: async () => [],
      } as unknown as ReconcilerDeps["hub"],
      masterKey: new Uint8Array(32),
      nodeIdentity: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
      store,
      now: () => 1_000,
      log: (message) => lines.push(message),
    } as ReconcilerDeps;

    const checking = startChecking(deps, 20);
    await checking.lastRun;
    await new Promise((resolve) => setTimeout(resolve, 90));
    checking.close();
    const runs = lines.filter((l) => l === "payment check finished (simulated)").length;
    expect(runs).toBeGreaterThanOrEqual(3);
    expect(store.checking().checkedAt).toBe(1_000);
  });
});

describe("discrepancies from a run (story 10.3)", () => {
  it("opens a discrepancy with the event id and both sides' values for a payment with no pledge", async () => {
    const discrepancies = new DiscrepancyStore(join(folder, "from-run.json"));
    const reference = "d".repeat(128);
    const request = {
      externalReference: reference,
      amount: { minor: 50_000, currency: "ZAR" },
      status: "completed",
    };
    const deps: ReconcilerDeps = {
      simulated: { payIn: { requests: () => [request] } } as unknown as ReconcilerDeps["simulated"],
      ledger: {} as ReconcilerDeps["ledger"],
      hub: {
        heldCommunities: () => [],
        journalOf: async () => [],
      } as unknown as ReconcilerDeps["hub"],
      masterKey: new Uint8Array(32),
      nodeIdentity: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
      store: new CheckingStore(join(folder, "from-run-checking.json")),
      discrepancies,
      now: () => 2_000,
      log: () => undefined,
    } as ReconcilerDeps;

    const checking = startChecking(deps, 60_000);
    await checking.lastRun;
    checking.close();
    const [item] = discrepancies.list();
    expect(item).toMatchObject({
      kind: "paid_no_pledge",
      eventId: reference,
      provider: "paid",
      record: "no matching pledge",
      books: "no matching pledge",
    });
    expect(item!.text).toContain("(simulated)");
    expect(discrepancies.list()).toHaveLength(1);
  });
});
