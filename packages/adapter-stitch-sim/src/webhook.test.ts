// Signature tests for the simulated webhook path: the same `ingestWebhook` the real adapter will use.
import { describe, expect, it } from "vite-plus/test";
import { money, type PaymentRequest, type WebhookDelivery } from "@shopong/ports";
import { randomEventId } from "@shopong/ports-contract";
import { createSimulatedStitch, SIGNATURE_HEADER, SIMULATED_MODE } from "./index.js";
import { lineSink, manualClock, randomKey, webCryptoHmac } from "./testing.js";

function setup() {
  const key = randomKey();
  const log = lineSink();
  const sim = createSimulatedStitch({
    webhookKey: key,
    hmac: webCryptoHmac,
    clock: manualClock(),
    log: log.log,
  });
  return { key, log, sim, payIn: sim.payIn };
}

async function pending(
  sim: ReturnType<typeof setup>["sim"],
  minor = 15000,
): Promise<PaymentRequest> {
  const created = await sim.payIn.createRequest({
    amount: money("ZAR", minor),
    externalReference: randomEventId(),
    payerReference: "STOKVEL",
    beneficiaryReference: "OCN POOL",
    expireAt: Date.UTC(2026, 9, 27),
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

/** Signs a body with a key, the way a processor would. Used to build deliveries the tests then change. */
async function signed(key: Uint8Array, body: string): Promise<WebhookDelivery> {
  const digest = await webCryptoHmac(key, new TextEncoder().encode(body));
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
  return { headers: { [SIGNATURE_HEADER]: hex }, body };
}

function completionBody(paymentId: string, quantity: string): string {
  return JSON.stringify({
    type: "PaymentInitiationRequestCompleted",
    data: {
      paymentInitiationRequest: {
        id: paymentId,
        externalReference: "x",
        amount: { quantity, currency: "ZAR" },
      },
    },
  });
}

describe("the simulated webhook signature", () => {
  it("is HMAC-SHA512 over the raw body, as 128 hex characters, under the Node's key", async () => {
    const { key, sim } = setup();
    const request = await pending(sim);
    const delivery = await sim.payIn.settle(request.id, "completed");
    expect(delivery.headers[SIGNATURE_HEADER]).toBe(
      (await signed(key, delivery.body)).headers[SIGNATURE_HEADER],
    );
    expect(delivery.headers[SIGNATURE_HEADER]).toMatch(/^[0-9a-f]{128}$/u);
  });

  it("applies a correctly signed completion exactly once; the replay is applied: false", async () => {
    const { sim, payIn } = setup();
    const request = await pending(sim);
    const delivery = await sim.payIn.settle(request.id, "completed");
    const first = await payIn.ingestWebhook(delivery);
    expect(first.ok && first.value.applied).toBe(true);
    const replay = await payIn.ingestWebhook(delivery);
    expect(replay.ok && replay.value.applied).toBe(false);
    expect((await payIn.getRequest(request.id))?.status).toBe("completed");
  });

  it("refuses a tampered body and changes nothing", async () => {
    const { sim, payIn } = setup();
    const request = await pending(sim);
    const delivery = await sim.payIn.settle(request.id, "completed");
    const tampered = { headers: delivery.headers, body: `${delivery.body} ` };
    const result = await payIn.ingestWebhook(tampered);
    expect(!result.ok && result.error.code).toBe("invalid_signature");
    expect((await payIn.getRequest(request.id))?.status).toBe("pending");
  });

  it("refuses an amount changed in the body, even under the old signature", async () => {
    const { sim, payIn } = setup();
    const request = await pending(sim, 15000);
    const delivery = await sim.payIn.settle(request.id, "completed");
    const bigger = delivery.body.replace('"150.00"', '"9999.00"');
    expect(bigger).not.toBe(delivery.body);
    const result = await payIn.ingestWebhook({ headers: delivery.headers, body: bigger });
    expect(!result.ok && result.error.code).toBe("invalid_signature");
    expect((await payIn.getRequest(request.id))?.status).toBe("pending");
  });

  it("refuses a delivery with no signature header", async () => {
    const { sim, payIn } = setup();
    const request = await pending(sim);
    const delivery = await sim.payIn.settle(request.id, "completed");
    const result = await payIn.ingestWebhook({ headers: {}, body: delivery.body });
    expect(!result.ok && result.error.code).toBe("invalid_signature");
    expect((await payIn.getRequest(request.id))?.status).toBe("pending");
  });

  it("refuses a signature with one character changed", async () => {
    const { sim, payIn } = setup();
    const request = await pending(sim);
    const delivery = await sim.payIn.settle(request.id, "completed");
    const sig = delivery.headers[SIGNATURE_HEADER] ?? "";
    const flipped = (sig[0] === "0" ? "1" : "0") + sig.slice(1);
    const result = await payIn.ingestWebhook({
      headers: { [SIGNATURE_HEADER]: flipped },
      body: delivery.body,
    });
    expect(!result.ok && result.error.code).toBe("invalid_signature");
  });

  it("refuses a delivery signed with another Node's key", async () => {
    const { sim, payIn } = setup();
    const request = await pending(sim);
    const foreign = await signed(randomKey(), completionBody(request.id, "150.00"));
    const result = await payIn.ingestWebhook(foreign);
    expect(!result.ok && result.error.code).toBe("invalid_signature");
    expect((await payIn.getRequest(request.id))?.status).toBe("pending");
  });

  it("refuses a validly signed webhook for a payment that was never created", async () => {
    const { key, payIn } = setup();
    const result = await payIn.ingestWebhook(
      await signed(key, completionBody("pir_999", "150.00")),
    );
    expect(!result.ok && result.error.code).toBe("unknown_payment");
  });

  it("refuses a validly signed body that is not JSON, and one that is not a payment event", async () => {
    const { key, sim, payIn } = setup();
    const request = await pending(sim);
    const notJson = await payIn.ingestWebhook(await signed(key, "not json"));
    expect(!notJson.ok && notJson.error.code).toBe("malformed");
    const payoutShaped = await payIn.ingestWebhook(
      await signed(
        key,
        JSON.stringify({
          type: "SimulatedDisbursementCompleted",
          data: { disbursement: { id: request.id } },
        }),
      ),
    );
    expect(!payoutShaped.ok && payoutShaped.error.code).toBe("malformed");
    expect((await payIn.getRequest(request.id))?.status).toBe("pending");
  });

  it("refuses a validly signed completion whose amount does not match the request", async () => {
    const { key, sim, payIn } = setup();
    const request = await pending(sim, 15000);
    const result = await payIn.ingestWebhook(await signed(key, completionBody(request.id, "1.00")));
    expect(!result.ok && result.error.code).toBe("malformed");
    expect((await payIn.getRequest(request.id))?.status).toBe("pending");
  });

  it("every refusal log line names the simulation", async () => {
    const { sim, payIn, log } = setup();
    const request = await pending(sim);
    const delivery = await sim.payIn.settle(request.id, "completed");
    await payIn.ingestWebhook({ headers: {}, body: delivery.body });
    await payIn.ingestWebhook({ headers: delivery.headers, body: `${delivery.body} ` });
    expect(log.lines.length).toBeGreaterThan(0);
    for (const line of log.lines) expect(line).toContain("simulated");
    expect(SIMULATED_MODE).toBe("simulated-stitch");
  });
});
