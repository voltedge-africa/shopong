import { describe, expect, it } from "vite-plus/test";
import { decodeEvent, encodeEvent, eventIdOf, webCryptoSha512 } from "@shopong/events";
import { money, type EventId } from "@shopong/ports";
import {
  ACCEPTANCE_SEQUENCE,
  ACCOUNT_POOL,
  createStokvelScenario,
  memberAccount,
  paySupplier,
  pledgeFor,
  plan,
  sharesOf,
  type Milestone,
  type StokvelScenario,
} from "../src/index.js";

/** A time inside every capability's validity window, after the scripted steps. */
const LATER = Date.UTC(2026, 0, 1) + 20 * 24 * 3_600_000;

const fresh = (seed?: string): StokvelScenario =>
  createStokvelScenario({ sha512: webCryptoSha512, ...(seed === undefined ? {} : { seed }) });

/** Collapse runs of the same milestone: pledge, pledge, pledge becomes pledge. */
function distinct(milestones: readonly Milestone[]): Milestone[] {
  return milestones.filter((m, i) => m !== milestones[i - 1]);
}

describe("the scripted order", () => {
  it("runs in 16 steps, one press each, and then stops", async () => {
    const s = fresh();
    expect(s.stepCount).toBe(16);
    const outcomes = [];
    for (let i = 0; i < 16; i++) {
      const outcome = await s.step();
      expect(outcome?.step).toBe(i + 1);
      expect(outcome?.entries.length).toBeGreaterThan(0);
      outcomes.push(outcome);
    }
    expect(await s.step()).toBeUndefined();
    expect(outcomes.map((o) => o?.id)).toEqual([
      "create-stokvel",
      "invite-members",
      "members-join",
      "propose-order",
      "approve-order",
      "add-quotes",
      "select-quote",
      "pledges",
      "payments",
      "retry-payment",
      "pool-funded",
      "pay-supplier",
      "plan-delivery",
      "confirm-delivery",
      "collect",
      "close-order",
    ]);
    expect((await s.snapshot()).done).toBe(true);
  });

  it("shows order proposed, pledges received, supplier paid, delivery planned and collection confirmed, in order", async () => {
    const snapshot = await fresh().runAll();
    const milestones = snapshot.timeline.map((e) => e.milestone);
    const shown = distinct(milestones.filter((m) => ACCEPTANCE_SEQUENCE.includes(m)));
    expect(shown).toEqual([...ACCEPTANCE_SEQUENCE]);
    // And each one comes after the one before it: nothing of the later kind appears earlier.
    const firsts = ACCEPTANCE_SEQUENCE.map((m) => milestones.indexOf(m));
    expect([...firsts].sort((a, b) => a - b)).toEqual(firsts);
    const lastPledge = milestones.lastIndexOf("pledge-received");
    expect(lastPledge).toBeLessThan(milestones.indexOf("supplier-paid"));
    expect(milestones.indexOf("collection-confirmed")).toBeGreaterThan(
      milestones.indexOf("delivery-planned"),
    );
    expect(milestones.filter((m) => m === "collection-confirmed")).toHaveLength(5);
  });

  it("writes the events of architecture 5.1 in order", async () => {
    const snapshot = await fresh().runAll();
    const types = snapshot.timeline.filter((e) => e.eventId !== undefined).map((e) => e.eventType);
    const first = (t: string): number => types.indexOf(t);
    expect(distinct(types as unknown as Milestone[])[0]).toBe("member.joined");
    for (const [a, b] of [
      ["member.invited", "order.proposed"],
      ["order.proposed", "order.approved"],
      ["order.approved", "quote.added"],
      ["quote.added", "quote.selected"],
      ["quote.selected", "pledge.created"],
      ["pledge.created", "payment.requested"],
      ["payment.requested", "payment.completed"],
      ["payment.completed", "delivery.planned"],
      ["delivery.planned", "delivery.confirmed"],
      ["delivery.confirmed", "collection.confirmed"],
      ["collection.confirmed", "order.closed"],
    ] as const) {
      expect(first(a), `${a} before ${b}`).toBeLessThan(first(b));
    }
    expect(types.filter((t) => t === "pledge.created")).toHaveLength(6); // five members and one retry
    expect(types.filter((t) => t === "payment.failed")).toHaveLength(1);
  });

  it("states money in words: requested, paid, failed", async () => {
    const snapshot = await fresh().runAll();
    const words = new Set(snapshot.timeline.flatMap((e) => (e.money ? [e.money.words] : [])));
    expect([...words].sort()).toEqual(["Paid", "Payment failed", "Payment requested"]);
    const failed = snapshot.timeline.find((e) => e.money?.state === "failed");
    expect(failed?.title).toContain("Zanele Khumalo");
    expect(failed?.money?.amountText).toBe("R840.00");
  });

  it("gives every timeline entry a short event id that starts the full id", async () => {
    const snapshot = await fresh().runAll();
    const withIds = snapshot.timeline.filter((e) => e.eventId !== undefined);
    expect(withIds.length).toBe(snapshot.timeline.length - 1); // all but the derived "pool funded" entry
    for (const e of withIds) {
      expect(e.eventId).toMatch(/^[0-9a-f]{128}$/);
      expect(e.eventIdShort).toBe(e.eventId?.slice(0, 8));
    }
    expect(snapshot.timeline.map((e) => e.index)).toEqual(snapshot.timeline.map((_, i) => i + 1));
  });

  it("tracks funding step by step", async () => {
    const s = fresh();
    for (let i = 0; i < 7; i++) await s.step();
    expect((await s.snapshot()).funding).toMatchObject({
      paidMinor: 0,
      targetMinor: 418_000,
      percent: 0,
      funded: false,
    });
    await s.step(); // pledges
    expect((await s.snapshot()).funding).toMatchObject({ paidMinor: 0, pendingMinor: 420_000 });
    await s.step(); // payments: four paid, one declined
    const after = await s.snapshot();
    expect(after.funding).toMatchObject({ paidMinor: 336_000, percent: 80, funded: false });
    expect(after.members.find((m) => m.key === "m4")?.status).toBe(
      "Payment failed, needs another try",
    );
    expect(after.members.find((m) => m.key === "m2")?.status).toBe("Paid R840.00");
    await s.step(); // retry
    expect((await s.snapshot()).funding).toMatchObject({
      paidMinor: 420_000,
      percent: 100,
      funded: true,
    });
  });

  it("closes with a per-member summary", async () => {
    const snapshot = await fresh().runAll();
    expect(snapshot.summary?.totalCostText).toBe("R4\u00a0180.00");
    expect(snapshot.summary?.creditedBackText).toBe("R20.00");
    expect(snapshot.summary?.members).toHaveLength(5);
    for (const m of snapshot.summary?.members ?? []) {
      expect(m).toMatchObject({ paidText: "R840.00", shareText: "R836.00", creditText: "R4.00" });
    }
  });
});

describe("real envelopes", () => {
  it("every appended event is a valid known v1 envelope whose id is the SHA-512 of its bytes", async () => {
    const s = fresh();
    await s.runAll();
    const world = await s.world();
    // 46: the 44 of story 6 plus the two `place.registered` events of story 7.4 (the depot and the collection point).
    expect(world.events.size).toBe(46);
    for (const [id, event] of world.events) {
      const bytes = encodeEvent(event);
      const decoded = decodeEvent(bytes);
      expect(decoded.ok && decoded.known, event.type).toBe(true);
      expect(await eventIdOf(event, webCryptoSha512)).toBe(id);
      expect(event.actor).toMatch(/^did:key:z6Mk/);
      expect(event.space).toBe(world.spaceKey);
      expect(event.proof).toHaveLength(1);
    }
  });

  it("plans the route by place ids and a fingerprint: no coordinate in the planned route or its places", async () => {
    const s = fresh();
    await s.runAll();
    const world = await s.world();
    const planned = [...world.events.values()].filter((e) => e.type === "delivery.planned");
    expect(planned).toHaveLength(1);
    const payload = planned[0]?.payload as Record<string, unknown>;
    expect(payload.origin).toMatch(/^[0-9a-f]{64}$/);
    expect(payload.destination).toMatch(/^[0-9a-f]{64}$/);
    expect(payload.route).toMatchObject({ costing: "auto", tileRelease: "memory-tiles-2026.01" });
    expect((payload.route as { fingerprint: string }).fingerprint).toMatch(/^[0-9a-f]{128}$/);
    expect(JSON.stringify(payload)).not.toMatch(/lat|lng|polyline|Micro/);
    const places = [...world.events.values()].filter((e) => e.type === "place.registered");
    expect(places).toHaveLength(2);
    for (const place of places) {
      expect(JSON.stringify(place.payload)).not.toMatch(/lat|lng|Micro|Church|street/i);
      expect((place.payload as { addressCommitment: string }).addressCommitment).toMatch(
        /^[0-9a-f]{128}$/,
      );
    }
  });

  it("writes no coordinate in any delivery event (patch: the confirmation holds the order and the photo only)", async () => {
    const s0 = fresh();
    await s0.runAll();
    const world = await s0.world();
    const deliveries = [...world.events.values()].filter((e) => e.type.startsWith("delivery."));
    expect(deliveries.map((e) => e.type).sort()).toEqual([
      "delivery.confirmed",
      "delivery.planned",
    ]);
    for (const event of deliveries) {
      expect(JSON.stringify(event.payload)).not.toMatch(/lat|lng|Micro|polyline/);
    }
  });

  it("the shared record accepted every event: nothing was rejected", async () => {
    const s = fresh();
    await s.runAll();
    const world = await s.world();
    expect(await world.hub.view.list("rejected/")).toEqual([]);
    expect((await world.hub.view.get("order")) as object).toMatchObject({ status: "closed" });
  });

  it("keeps personal data out of the record (rule 6): no member names, no bank account numbers", async () => {
    const s = fresh();
    await s.runAll();
    const world = await s.world();
    const everything = [...world.events.values()].map((e) => JSON.stringify(e)).join("\n");
    for (const person of world.people) expect(everything).not.toContain(person.name);
    expect(everything).not.toContain(plan.SUPPLIER_BANK.accountNumber);
    expect(everything.toLowerCase()).not.toContain("accountnumber");
  });
});

describe("determinism", () => {
  it("two runs with the same seed give identical event ids, in order", async () => {
    const ids = async (seed?: string): Promise<(string | undefined)[]> =>
      (await fresh(seed).runAll()).timeline.map((e) => e.eventId);
    const a = await ids();
    expect(await ids()).toEqual(a);
    expect(await ids("ubuntu-savers-1")).toEqual(a);
  });

  it("reset() starts over and reproduces the same events", async () => {
    const s = fresh();
    const first = (await s.runAll()).timeline.map((e) => e.eventId);
    await s.reset();
    expect((await s.snapshot()).timeline).toEqual([]);
    expect((await s.runAll()).timeline.map((e) => e.eventId)).toEqual(first);
  });

  it("a different seed gives different ids", async () => {
    const a = (await fresh().runAll()).timeline.map((e) => e.eventId);
    const b = (await fresh("another-stokvel").runAll()).timeline.map((e) => e.eventId);
    expect(b).not.toEqual(a);
    expect(new Set(b.filter(Boolean)).size).toBe(b.filter(Boolean).length);
  });
});

describe("idempotency: every external effect is keyed by an event id", () => {
  it("re-running any step posts and records nothing twice", async () => {
    const s = fresh();
    await s.runAll();
    const world = await s.world();
    let changes = 0;
    world.hub.subscribe(() => changes++);
    const trialBefore = await world.ledger.trialBalance();
    const created = (): number => world.effects.filter((e) => !e.replayed).length;
    const effectsBefore = created();
    const timelineBefore = (await s.snapshot()).timeline;
    const eventCount = world.events.size;

    for (let step = 1; step <= 16; step++) await s.rerun(step);

    expect(changes).toBe(0); // the record gained no entry, so its view never changed
    expect(world.events.size).toBe(eventCount);
    expect(created()).toBe(effectsBefore);
    expect(await world.ledger.trialBalance()).toEqual(trialBefore);
    expect((await s.snapshot()).timeline).toEqual(timelineBefore);
    expect((await s.reconcile()).ok).toBe(true);
    // The effects that did run again were recognised, not repeated.
    const replays = world.effects.filter((e) => e.replayed);
    expect(replays.length).toBeGreaterThan(0);
    expect(new Set(replays.map((e) => `${e.kind}:${e.key}`)).size).toBe(replays.length);
    expect(replays.length).toBe(effectsBefore); // each effect was offered once more, and recognised once
  });

  it("each effect carries the event id that caused it", async () => {
    const s = fresh();
    await s.runAll();
    const world = await s.world();
    const kinds = world.effects.reduce<Record<string, number>>(
      (n, e) => ({ ...n, [e.kind]: (n[e.kind] ?? 0) + 1 }),
      {},
    );
    expect(kinds).toEqual({ "payin.request": 6, "ledger.post": 6, "payout.create": 1 });
    for (const e of world.effects) {
      expect(world.events.has(e.key), e.kind).toBe(true);
      if (e.kind === "ledger.post") {
        const txn = await world.ledger.findByIdempotencyKey(e.key);
        expect(txn?.metadata.eventSha512).toBe(e.key);
      }
    }
  });

  it("re-running the supplier step does not pay the supplier twice", async () => {
    const s = fresh();
    await s.runAll();
    const world = await s.world();
    const before = (await world.ledger.balance(ACCOUNT_POOL, "ZAR")).balance.minor;
    await s.rerun(12);
    await s.rerun(12);
    expect((await world.ledger.balance(ACCOUNT_POOL, "ZAR")).balance.minor).toBe(before);
    expect(world.effects.filter((e) => e.kind === "payout.create" && !e.replayed)).toHaveLength(1);
  });

  it("refuses to re-run a step that has not run", async () => {
    const s = fresh();
    await s.step();
    await expect(s.rerun(2)).rejects.toThrow("has not run yet");
  });
});

describe("the books agree with the record", () => {
  it("pool = contributions - supplier payment, and every member account is right", async () => {
    const s = fresh();
    await s.runAll();
    const world = await s.world();
    const pool = await world.ledger.balance(ACCOUNT_POOL, "ZAR");
    expect(pool.balance.minor).toBe(5 * 84_000 - 418_000);
    for (const m of plan.MEMBERS) {
      expect((await world.ledger.balance(memberAccount(m.key), "ZAR")).balance).toEqual(
        money("ZAR", 400),
      );
    }
    const members = plan.MEMBERS.length;
    expect(sharesOf(418_000, members)).toEqual([83_600, 83_600, 83_600, 83_600, 83_600]);
    const reconciliation = await s.reconcile();
    expect(reconciliation).toMatchObject({
      ok: true,
      problems: [],
      contributionsMinor: 420_000,
      supplierPaidMinor: 418_000,
      poolMinor: 2_000,
    });
    // What members are owed back adds up to what is left in the pool.
    expect(reconciliation.members.reduce((n, m) => n + m.creditMinor, 0)).toBe(
      reconciliation.poolMinor,
    );
    const trial = await world.ledger.trialBalance();
    expect(trial.totals).toEqual([
      { currency: "ZAR", debits: 420_000 + 418_000, credits: 420_000 + 418_000 },
    ]);
  });

  it("the failed payment never reaches the books", async () => {
    const s = fresh();
    for (let i = 0; i < 9; i++) await s.step();
    const world = await s.world();
    expect((await world.ledger.balance(ACCOUNT_POOL, "ZAR")).balance.minor).toBe(4 * 84_000);
    expect((await world.ledger.balance(memberAccount("m4"), "ZAR")).balance.minor).toBe(0);
  });

  it("a mismatch is reported, not hidden", async () => {
    const s = fresh();
    await s.runAll();
    const world = await s.world();
    // Someone posts to the books without a matching event in the record.
    await world.ledger.post({
      idempotencyKey: "f".repeat(128),
      description: "stray",
      entries: [
        { account: ACCOUNT_POOL, direction: "debit", amount: money("ZAR", 100) },
        { account: memberAccount("m2"), direction: "credit", amount: money("ZAR", 100) },
      ],
    });
    const reconciliation = await s.reconcile();
    expect(reconciliation.ok).toBe(false);
    expect(reconciliation.problems.join("\n")).toContain("pool holds");
  });
});

describe("the record enforces authority and order", () => {
  const nextOf = async (s: StokvelScenario, steps: number): Promise<void> => {
    for (let i = 0; i < steps; i++) await s.step();
  };

  it("refuses a supplier payout above the treasurer's ceiling", async () => {
    const s = fresh();
    await nextOf(s, 11);
    const world = await s.world();
    const treasurer = world.person("m1");
    const over = await world.emit(
      treasurer,
      "payment.requested",
      {
        direction: "out",
        order: "o1",
        supplier: "s1",
        amountMinor: plan.CEILING_MINOR + 1,
        approvers: [treasurer.actor],
      },
      { at: LATER, label: "forged:over-ceiling" },
    );
    expect(over.accepted).toBe(false);
    const rejected = (await world.hub.view.get(`rejected/${over.id}`)) as { reason: string };
    expect(rejected.reason).toContain("insufficient_capability");
    const result = await paySupplier(world, over.id, [], LATER);
    expect(result.done).toBe(false);
    expect(world.effects.filter((e) => e.kind === "payout.create")).toHaveLength(0);
  });

  it("refuses a payout decision from a member who holds no payment/approve capability", async () => {
    const s = fresh();
    await nextOf(s, 11);
    const world = await s.world();
    const thabo = world.person("m2");
    const forged = await world.emit(
      thabo,
      "payment.requested",
      {
        direction: "out",
        order: "o1",
        supplier: "s1",
        amountMinor: 418_000,
        approvers: [thabo.actor],
      },
      { at: LATER, label: "forged:member-payout" },
    );
    expect(forged.accepted).toBe(false);
    expect(
      ((await world.hub.view.get(`rejected/${forged.id}`)) as { reason: string }).reason,
    ).toContain("insufficient_capability");
  });

  it("refuses to pay the supplier before the pool is funded", async () => {
    const s = fresh();
    await nextOf(s, 9); // one member's payment was declined
    const world = await s.world();
    const treasurer = world.person("m1");
    const early = await world.emit(
      treasurer,
      "payment.requested",
      {
        direction: "out",
        order: "o1",
        supplier: "s1",
        amountMinor: 418_000,
        approvers: [treasurer.actor],
      },
      { at: LATER, label: "forged:early" },
    );
    expect(early.accepted).toBe(false);
    expect(((await world.hub.view.get(`rejected/${early.id}`)) as { reason: string }).reason).toBe(
      "the pool is not funded yet",
    );
    expect((await paySupplier(world, early.id as EventId, [], LATER)).done).toBe(false);
  });

  it("a member cannot pledge or collect for someone else", async () => {
    const s = fresh();
    await nextOf(s, 7);
    const world = await s.world();
    const forged = await world.emit(
      world.person("m2"),
      "pledge.created",
      { member: "m3", order: "o1", amountMinor: 1, attempt: 1 },
      { at: LATER, label: "forged:pledge-for-other" },
    );
    expect(forged.accepted).toBe(false);
  });

  it("pledgeFor rounds the biggest share up to a round amount", () => {
    expect(pledgeFor(418_000, 5)).toBe(84_000);
    expect(pledgeFor(418_003, 5)).toBe(84_000);
    expect(sharesOf(418_003, 5)).toEqual([83_601, 83_601, 83_601, 83_600, 83_600]);
  });
});
