// Expiry runs on the injected clock. A completion that arrives after expiry is never applied: the status stays
// `expired` and the event is flagged as a late completion for reconciliation (plan Open Question 7).
import { describe, expect, it } from "vite-plus/test";
import { money } from "@shopong/ports";
import { randomEventId } from "@shopong/ports-contract";
import { createSimulatedStitch } from "./index.js";
import { lineSink, manualClock, randomKey, webCryptoHmac } from "./testing.js";

function setup() {
  const clock = manualClock();
  const log = lineSink();
  const sim = createSimulatedStitch({
    webhookKey: randomKey(),
    hmac: webCryptoHmac,
    clock,
    log: log.log,
  });
  return { clock, log, sim };
}

async function request(sim: ReturnType<typeof setup>["sim"], expireAt: number) {
  const created = await sim.payIn.createRequest({
    amount: money("ZAR", 15050),
    externalReference: randomEventId(),
    payerReference: "STOKVEL",
    beneficiaryReference: "OCN POOL",
    expireAt,
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

describe("expiry of a payment request", () => {
  it("expires a request at its expireAt, on the injected clock", async () => {
    const { clock, sim } = setup();
    const made = await request(sim, clock.now() + 1000);
    clock.advance(999);
    expect((await sim.payIn.getRequest(made.id))?.status).toBe("pending");
    clock.advance(1);
    expect((await sim.payIn.getRequest(made.id))?.status).toBe("expired");
  });

  it("refuses to create a request that is already past its expiry", async () => {
    const { clock, sim } = setup();
    const created = await sim.payIn.createRequest({
      amount: money("ZAR", 100),
      externalReference: randomEventId(),
      payerReference: "A",
      beneficiaryReference: "B",
      expireAt: clock.now(),
    });
    expect(!created.ok && created.error.code).toBe("invalid_request");
  });

  it("refuses an expireAt outside the range of a JavaScript Date", async () => {
    const { sim } = setup();
    const created = await sim.payIn.createRequest({
      amount: money("ZAR", 100),
      externalReference: randomEventId(),
      payerReference: "A",
      beneficiaryReference: "B",
      expireAt: 9e15,
    });
    expect(!created.ok && created.error.code).toBe("invalid_request");
  });

  it("applies a completion that arrives before expiry, and it is not late", async () => {
    const { clock, sim } = setup();
    const made = await request(sim, clock.now() + 1000);
    const outcome = await sim.payIn.ingestWebhook(await sim.payIn.settle(made.id, "completed"));
    expect(outcome.ok && outcome.value.applied).toBe(true);
    expect(outcome.ok && outcome.value.lateCompletion).toBe(false);
    expect(sim.lateCompletions()).toEqual([]);
  });

  it("does not apply a completion that arrives after expiry; it flags the late completion", async () => {
    const { clock, log, sim } = setup();
    const made = await request(sim, clock.now() + 1000);
    clock.advance(5000);
    const outcome = await sim.payIn.ingestWebhook(await sim.payIn.settle(made.id, "completed"));
    expect(outcome.ok && outcome.value.applied).toBe(false);
    expect(outcome.ok && outcome.value.lateCompletion).toBe(true);
    expect(outcome.ok && outcome.value.payment.status).toBe("expired");
    expect((await sim.payIn.getRequest(made.id))?.status).toBe("expired");
    const late = sim.lateCompletions();
    expect(late).toHaveLength(1);
    expect(late[0]).toMatchObject({ paymentId: made.id, kind: "pay_in", status: "expired" });
    expect(log.lines.some((line) => line.includes("late"))).toBe(true);
    for (const line of log.lines) expect(line).toContain("simulated");
  });

  it("flags a late completion even when nothing read the request before the webhook came", async () => {
    const { clock, sim } = setup();
    const made = await request(sim, clock.now() + 1000);
    const delivery = await sim.payIn.settle(made.id, "completed");
    clock.advance(5000);
    const outcome = await sim.payIn.ingestWebhook(delivery);
    expect(outcome.ok && outcome.value.lateCompletion).toBe(true);
    expect(outcome.ok && outcome.value.applied).toBe(false);
  });

  it("flags a late completion once: a replay of the same late delivery is not flagged again", async () => {
    const { clock, sim } = setup();
    const made = await request(sim, clock.now() + 1000);
    const delivery = await sim.payIn.settle(made.id, "completed");
    clock.advance(5000);
    await sim.payIn.ingestWebhook(delivery);
    const again = await sim.payIn.ingestWebhook(delivery);
    expect(again.ok && again.value.lateCompletion).toBe(false);
    expect(sim.lateCompletions()).toHaveLength(1);
  });

  it("does not flag an expiry notice or a cancellation as a late completion", async () => {
    const { clock, sim } = setup();
    const made = await request(sim, clock.now() + 1000);
    clock.advance(5000);
    const expiredNotice = await sim.payIn.ingestWebhook(await sim.payIn.settle(made.id, "expired"));
    expect(expiredNotice.ok && expiredNotice.value.lateCompletion).toBe(false);
    expect(sim.lateCompletions()).toEqual([]);
  });

  it("refuses a bank-page approval of an expired request, and flags nothing (review item 4)", async () => {
    const { clock, log, sim } = setup();
    const made = await request(sim, clock.now() + 1000);
    clock.advance(5000);
    const approval = await sim.payIn.actAsPayer(made.id, "completed");
    expect(!approval.ok && approval.error.code).toBe("expired");
    expect(sim.lateCompletions()).toEqual([]);
    expect((await sim.payIn.getRequest(made.id))?.status).toBe("expired");
    expect(log.lines).toEqual([]);
  });

  it("applies a bank-page approval of a pending request, as a verified delivery", async () => {
    const { clock, sim } = setup();
    const made = await request(sim, clock.now() + 1000);
    const approval = await sim.payIn.actAsPayer(made.id, "completed");
    expect(approval.ok && approval.value.applied).toBe(true);
  });

  it("keeps an expired request expired when it is cancelled afterwards", async () => {
    const { clock, sim } = setup();
    const made = await request(sim, clock.now() + 1000);
    clock.advance(5000);
    const cancelled = await sim.payIn.cancelRequest(made.id);
    expect(cancelled.ok && cancelled.value.status).toBe("expired");
  });
});
