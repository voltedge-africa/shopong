import { describe, expect, it } from "vite-plus/test";
import { webCryptoSha512 } from "@shopong/events";
import {
  ACCEPTANCE_SEQUENCE,
  createStokvelScenario,
  type Milestone,
} from "@shopong/scenario-stokvel";

import { createDemoController } from "./demoController";
import { allRows, demoScreenModel } from "./demoModel";

const newController = () =>
  createDemoController(createStokvelScenario({ sha512: webCryptoSha512 }));

const distinct = (items: readonly Milestone[]): Milestone[] =>
  items.filter((m, i) => m !== items[i - 1]);

describe("the /demo screen, driven the way a person drives it", () => {
  it("shows order proposed, pledges received, supplier paid, delivery planned and collection confirmed, in order (story 1.4 AC)", async () => {
    const controller = newController();
    await controller.load();
    expect(controller.getState().status).toBe("ready");

    // Press "Next step" until the button says the order is finished, as a person would.
    let presses = 0;
    while (demoScreenModel(controller.getState().snapshot!).next.enabled) {
      await controller.next();
      presses++;
      expect(presses).toBeLessThanOrEqual(16);
    }
    expect(presses).toBe(16);

    const model = demoScreenModel(controller.getState().snapshot!);
    const rows = allRows(model);
    const shown = distinct(
      rows.map((r) => r.milestone).filter((m) => ACCEPTANCE_SEQUENCE.includes(m)),
    );
    expect(shown).toEqual([...ACCEPTANCE_SEQUENCE]);

    // The sentences the screen prints, in the order it prints them.
    const text = rows.map((r) => r.title);
    const at = (needle: string): number => text.findIndex((t) => t.includes(needle));
    expect(at("proposed a bulk order")).toBeGreaterThan(-1);
    expect(at("proposed a bulk order")).toBeLessThan(at("pledged R840.00"));
    expect(at("pledged R840.00")).toBeLessThan(at("Supplier paid"));
    expect(at("Supplier paid")).toBeLessThan(at("planned delivery"));
    expect(at("planned delivery")).toBeLessThan(at("collected their share"));
    expect(model.progressLabel).toBe("All 16 steps done");
    expect(model.next.enabled).toBe(false);
  });

  it("matches what the scenario package says happened: same entries, same order, same ids", async () => {
    const scenario = createStokvelScenario({ sha512: webCryptoSha512 });
    const controller = createDemoController(scenario);
    await controller.load();
    await controller.runAll();
    const snapshot = await scenario.snapshot();
    const rows = allRows(demoScreenModel(controller.getState().snapshot!));
    expect(rows.map((r) => r.title)).toEqual(snapshot.timeline.map((e) => e.title));
    expect(rows.map((r) => r.idText)).toEqual(
      snapshot.timeline.map((e) =>
        e.eventIdShort === undefined ? "Worked out from the record" : `Event ${e.eventIdShort}`,
      ),
    );
  });

  it("only ever adds rows at the end while stepping, so the list never reorders", async () => {
    const controller = newController();
    await controller.load();
    let previous: string[] = [];
    for (let i = 0; i < 16; i++) {
      await controller.next();
      const keys = allRows(demoScreenModel(controller.getState().snapshot!)).map((r) => r.key);
      expect(keys.slice(0, previous.length)).toEqual(previous);
      expect(keys.length).toBeGreaterThan(previous.length);
      previous = keys;
    }
  });

  it("groups rows under the step that produced them, in plain words", async () => {
    const controller = newController();
    await controller.load();
    await controller.runAll();
    const groups = demoScreenModel(controller.getState().snapshot!).groups;
    expect(groups).toHaveLength(16);
    expect(groups[7]?.heading).toBe("Step 8: Every member pledges their share");
    expect(groups[0]?.heading).toBe("Step 1: Nomsa starts the stokvel");
  });

  it("describes money states in words and flags the failed payment", async () => {
    const controller = newController();
    await controller.load();
    await controller.runAll();
    const rows = allRows(demoScreenModel(controller.getState().snapshot!));
    const moneyTexts = new Set(
      rows.flatMap((r) => (r.money ? [r.money.text.split(":")[0] ?? ""] : [])),
    );
    expect([...moneyTexts].sort((a, b) => a.localeCompare(b))).toEqual([
      "Paid",
      "Payment failed",
      "Payment requested",
    ]);
    const failed = rows.find((r) => r.money?.state === "failed");
    expect(failed?.accessibilityLabel).toContain("Payment failed: R840.00");
    expect(failed?.accessibilityLabel).toMatch(/Event [0-9a-f]{8}\.$/);
  });

  it("shows a funding bar that fills as payments arrive, and a final summary", async () => {
    const controller = newController();
    await controller.load();
    const fundingAfter = async (steps: number) => {
      for (let i = 0; i < steps; i++) await controller.next();
      return demoScreenModel(controller.getState().snapshot!).funding;
    };
    expect((await fundingAfter(7)).percent).toBe(0);
    await controller.next(); // pledges
    expect(demoScreenModel(controller.getState().snapshot!).funding.percent).toBe(0);
    const after = await fundingAfter(1); // payments: one declined
    expect(after.percent).toBe(80);
    expect(after.funded).toBe(false);
    const done = await fundingAfter(1); // retry
    expect(done).toMatchObject({ percent: 100, funded: true });
    expect(demoScreenModel(controller.getState().snapshot!).summary).toBeUndefined();
    await controller.runAll();
    const summary = demoScreenModel(controller.getState().snapshot!).summary;
    expect(summary?.heading).toBe("The order is closed");
    expect(summary?.lines[0]).toBe("The groceries cost R4 180.00 in total.");
    expect(summary?.lines).toContain("Zanele Khumalo: paid R840.00, share R836.00, credit R4.00");
  });

  it("lists every member with a plain status, and no bank details", async () => {
    const controller = newController();
    await controller.load();
    for (let i = 0; i < 9; i++) await controller.next();
    const model = demoScreenModel(controller.getState().snapshot!);
    expect(model.members).toHaveLength(5);
    expect(model.members.find((m) => m.name === "Zanele Khumalo")?.status).toBe(
      "Payment failed, needs another try",
    );
    expect(JSON.stringify(model)).not.toMatch(/accountNumber|62999000123/);
  });
});

describe("the demo controller", () => {
  it("ignores a second press while a step is running", async () => {
    const controller = newController();
    await controller.load();
    await Promise.all([controller.next(), controller.next(), controller.next()]);
    expect(controller.getState().snapshot?.stepsDone).toBe(1);
    expect(controller.getState().busy).toBe(false);
  });

  it("announces each step for screen readers", async () => {
    const controller = newController();
    await controller.load();
    await controller.next();
    expect(controller.getState().announcement).toMatch(
      /^Step 1 done: Nomsa starts the stokvel\. 2 new entries/,
    );
  });

  it("starts again from the beginning with the same events", async () => {
    const controller = newController();
    await controller.load();
    await controller.runAll();
    const first = allRows(demoScreenModel(controller.getState().snapshot!)).map((r) => r.key);
    await controller.reset();
    expect(controller.getState().snapshot?.timeline).toEqual([]);
    await controller.runAll();
    expect(allRows(demoScreenModel(controller.getState().snapshot!)).map((r) => r.key)).toEqual(
      first,
    );
  });

  it("notifies subscribers and stops after unsubscribe", async () => {
    const controller = newController();
    let calls = 0;
    const off = controller.subscribe(() => calls++);
    await controller.load();
    expect(calls).toBeGreaterThan(0);
    off();
    const before = calls;
    await controller.next();
    expect(calls).toBe(before);
  });

  it("reports a failure instead of throwing", async () => {
    const scenario = createStokvelScenario({ sha512: webCryptoSha512 });
    const controller = createDemoController({
      ...scenario,
      step: () => Promise.reject(new Error("boom")),
    });
    await controller.load();
    await controller.next();
    expect(controller.getState()).toMatchObject({ status: "failed", error: "boom", busy: false });
  });
});
