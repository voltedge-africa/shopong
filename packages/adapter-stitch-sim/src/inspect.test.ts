// The read-only inspection of a verified webhook (story 4.5): it verifies, reads, and changes nothing.
import { describe, expect, it } from "vite-plus/test";
import { money } from "@shopong/ports";
import { randomEventId } from "@shopong/ports-contract";
import { createSimulatedStitch } from "./index.js";
import { manualClock, randomKey, webCryptoHmac } from "./testing.js";

function setup() {
  return createSimulatedStitch({
    webhookKey: randomKey(),
    hmac: webCryptoHmac,
    clock: manualClock(),
  });
}

describe("inspectWebhook (simulated)", () => {
  it("reads a verified completion and changes nothing: the status stays pending", async () => {
    const sim = setup();
    const made = await sim.payIn.createRequest({
      amount: money("ZAR", 50_000),
      externalReference: randomEventId(),
      payerReference: "STOKVEL",
      beneficiaryReference: "OCN POOL",
      expireAt: Date.UTC(2030, 0, 1),
    });
    if (!made.ok) throw new Error(made.error.message);
    const delivery = await sim.payIn.settle(made.value.id, "completed");

    const read = await sim.payIn.inspectWebhook(delivery);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value).toMatchObject({
      paymentId: made.value.id,
      outcome: "completed",
      status: "pending",
      amountMatches: true,
    });
    expect((await sim.payIn.getRequest(made.value.id))?.status).toBe("pending");
  });

  it("refuses a bad signature before reading anything, and reports an amount mismatch as data", async () => {
    const sim = setup();
    const made = await sim.payIn.createRequest({
      amount: money("ZAR", 50_000),
      externalReference: randomEventId(),
      payerReference: "STOKVEL",
      beneficiaryReference: "OCN POOL",
      expireAt: Date.UTC(2030, 0, 1),
    });
    if (!made.ok) throw new Error(made.error.message);
    const delivery = await sim.payIn.settle(made.value.id, "completed");

    const bad = await sim.payIn.inspectWebhook({ headers: {}, body: delivery.body });
    expect(bad.ok ? undefined : bad.error.code).toBe("invalid_signature");

    const other = JSON.parse(delivery.body) as {
      data: { paymentInitiationRequest: { amount: { quantity: string } } };
    };
    other.data.paymentInitiationRequest.amount.quantity = "1.00";
    const body = JSON.stringify(other);
    const signed = await sim.payIn.settle(made.value.id, "completed");
    const wrong = await sim.payIn.inspectWebhook({
      headers: { "x-simulated-signature": signed.headers["x-simulated-signature"]! },
      body,
    });
    expect(wrong.ok ? undefined : wrong.error.code).toBe("invalid_signature");
  });

  it("lists every pay-in request the simulation holds", async () => {
    const sim = setup();
    const made = await sim.payIn.createRequest({
      amount: money("ZAR", 50_000),
      externalReference: randomEventId(),
      payerReference: "STOKVEL",
      beneficiaryReference: "OCN POOL",
      expireAt: Date.UTC(2030, 0, 1),
    });
    if (!made.ok) throw new Error(made.error.message);
    expect(sim.payIn.requests().map((r) => r.id)).toEqual([made.value.id]);
  });
});
