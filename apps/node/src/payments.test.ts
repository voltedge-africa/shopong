// The simulated payments on the Node (story 4.4): the webhook route, the simulated bank page, the labels a person
// or a log sees, the start-up refusals, and restarts. Every surface says "simulated".
import { createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vite-plus/test";
import type { PaymentRequest } from "@shopong/ports";
import { money } from "@shopong/ports";
import { randomEventId } from "@shopong/ports-contract";
import { loadConfig } from "./config.ts";
import { ConfigError } from "./secrets.ts";
import { startNode, type RunningNode } from "./node.ts";
import { PAYMENTS_STATE_FILE } from "./payments.ts";
import { captureSink, FAKE_SECRETS } from "./testing/capture.ts";

let running: RunningNode | undefined;
const folders: string[] = [];
const freshFolder = (): string => {
  const folder = mkdtempSync(join(tmpdir(), "ocn-payments-"));
  folders.push(folder);
  return folder;
};

afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

afterEach(async () => {
  await running?.close();
  running = undefined;
});

const SIM_KEY = FAKE_SECRETS.SIMULATED_WEBHOOK_SECRET;

/** Payments on, simulated, on an ephemeral port with a folder of its own (or the one given). */
function env(
  folder: string = freshFolder(),
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    OCN_NODE_PORT: "0",
    OCN_NODE_DATA_DIR: folder,
    RECORD_MASTER_KEY: FAKE_SECRETS.RECORD_MASTER_KEY,
    OCN_NODE_PAYMENTS_ENABLED: "true",
    SIMULATED_WEBHOOK_SECRET: SIM_KEY,
    // The default environment is production, which refuses simulated payments unless this is set (review item 1).
    OCN_NODE_ALLOW_SIMULATED_PAYMENTS: "true",
    ...extra,
  };
}

function simulatedOf(node: RunningNode) {
  if (node.payments === undefined) throw new Error("test setup: payments are not running");
  return node.payments;
}

async function pendingRequest(node: RunningNode, minor = 15050): Promise<PaymentRequest> {
  const created = await simulatedOf(node).payIn.createRequest({
    amount: money("ZAR", minor),
    externalReference: randomEventId(),
    payerReference: "STOKVEL",
    beneficiaryReference: "OCN POOL",
    expireAt: Date.now() + 86_400_000,
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

/** Signs a body with the Node's key using Node's own crypto, independent of the adapter's code. */
function signedWithKey(body: string, key: string = SIM_KEY): string {
  return createHmac("sha512", Buffer.from(key, "hex")).update(body).digest("hex");
}

function completionBody(id: string, quantity: string): string {
  return JSON.stringify({
    type: "PaymentInitiationRequestCompleted",
    data: {
      paymentInitiationRequest: {
        id,
        externalReference: "x",
        amount: { quantity, currency: "ZAR" },
      },
    },
  });
}

async function postWebhook(node: RunningNode, body: string, signature?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature !== undefined) headers["x-simulated-signature"] = signature;
  return fetch(`${node.url}/webhooks/payments`, { method: "POST", headers, body });
}

/** The audit lines the Node wrote, as parsed objects. */
function auditLines(text: string): Record<string, unknown>[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((line) => line["audit"] !== undefined);
}

describe("the simulated payments on the Node", () => {
  it("says simulated in /ready, in the start-up log and in the component's mode", async () => {
    const sink = captureSink();
    running = await startNode({ env: env(), sink });
    const ready = await fetch(`${running.url}/ready`);
    expect(ready.status).toBe(200);
    const body = (await ready.json()) as { components: Record<string, unknown> };
    expect(body.components["payments"]).toEqual({ status: "ok", mode: "simulated-stitch" });
    expect(sink.text()).toContain("simulated-stitch");
    expect(sink.text()).toMatch(/simulated/u);
  });

  it("uses simulated when PAYMENTS_ADAPTER is not set, and names the choice", async () => {
    const { config } = loadConfig({ env: env() });
    expect(config.paymentsAdapter).toBe("simulated");
    const explicit = loadConfig({ env: env(undefined, { PAYMENTS_ADAPTER: "simulated" }) });
    expect(explicit.config.paymentsAdapter).toBe("simulated");
  });

  it("refuses PAYMENTS_ADAPTER=stitch to start, in a plain message that names the simulation", async () => {
    const error = await startNode({
      env: env(undefined, { PAYMENTS_ADAPTER: "stitch" }),
      sink: captureSink(),
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).message).toContain("PAYMENTS_ADAPTER=stitch");
    expect((error as ConfigError).message).toContain("simulated");
  });

  it("refuses an unknown PAYMENTS_ADAPTER value, naming the variable only", async () => {
    expect(() => loadConfig({ env: env(undefined, { PAYMENTS_ADAPTER: "bogus" }) })).toThrow(
      /PAYMENTS_ADAPTER: expected simulated or stitch/u,
    );
  });

  it("needs the simulated webhook secret, names the key and no value, and refuses a placeholder", async () => {
    const { SIMULATED_WEBHOOK_SECRET: _omitted, ...rest } = env();
    const missing = await startNode({ env: rest, sink: captureSink() }).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(missing).toBeInstanceOf(ConfigError);
    expect((missing as ConfigError).keys).toContain("SIMULATED_WEBHOOK_SECRET");

    const placeholder = "replace-with-64-hex-characters";
    const refused = await startNode({
      env: env(undefined, { SIMULATED_WEBHOOK_SECRET: placeholder }),
      sink: captureSink(),
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(refused).toBeInstanceOf(ConfigError);
    expect((refused as ConfigError).keys).toEqual(["SIMULATED_WEBHOOK_SECRET"]);
    expect((refused as ConfigError).message).not.toContain(placeholder);
  });

  it("does not require Stitch credentials in simulated mode", async () => {
    running = await startNode({ env: env(), sink: captureSink() });
    expect(running.payments).toBeDefined();
  });

  it("serves no payment routes while payments are off", async () => {
    running = await startNode({
      env: {
        OCN_NODE_PORT: "0",
        OCN_NODE_DATA_DIR: freshFolder(),
        RECORD_MASTER_KEY: FAKE_SECRETS.RECORD_MASTER_KEY,
      },
      sink: captureSink(),
    });
    expect(running.payments).toBeUndefined();
    expect((await postWebhook(running, "{}", "00")).status).toBe(404);
  });

  it("shows the simulated bank page for a request, with the banner and both buttons", async () => {
    running = await startNode({ env: env(), sink: captureSink() });
    const made = await pendingRequest(running);
    const page = await fetch(`${running.url}/simulated-bank/${made.id}`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    const html = await page.text();
    expect(html).toContain("SIMULATED");
    expect(html).toContain("No real money moves");
    expect(html).toContain("R150.50");
    expect(html).toContain("Approve test payment");
    expect(html).toContain("Cancel");
    expect((await fetch(`${running.url}/simulated-bank/pir_999`)).status).toBe(404);
  });

  it("approve on the bank page completes the request once, and each action is audited as simulated", async () => {
    const sink = captureSink();
    running = await startNode({ env: env(), sink });
    const made = await pendingRequest(running);
    const approve = await fetch(`${running.url}/simulated-bank/${made.id}/approve`, {
      method: "POST",
      redirect: "manual",
    });
    expect(approve.status).toBe(303);
    expect((await simulatedOf(running).payIn.getRequest(made.id))?.status).toBe("completed");
    const again = await fetch(`${running.url}/simulated-bank/${made.id}/approve`, {
      method: "POST",
      redirect: "manual",
    });
    expect(again.status).toBe(303);

    const audits = auditLines(sink.text()).filter((line) => line["audit"] === "simulated_bank");
    expect(audits).toHaveLength(2);
    for (const line of audits) expect(line["simulated"]).toBe(true);
  });

  it("cancel on the bank page cancels a pending request", async () => {
    running = await startNode({ env: env(), sink: captureSink() });
    const made = await pendingRequest(running);
    await fetch(`${running.url}/simulated-bank/${made.id}/cancel`, {
      method: "POST",
      redirect: "manual",
    });
    expect((await simulatedOf(running).payIn.getRequest(made.id))?.status).toBe("cancelled");
  });

  it("applies a signed completion once over HTTP; the replay is applied: false", async () => {
    const sink = captureSink();
    running = await startNode({ env: env(), sink });
    const made = await pendingRequest(running);
    const delivery = await simulatedOf(running).payIn.settle(made.id, "completed");

    const first = await postWebhook(
      running,
      delivery.body,
      delivery.headers["x-simulated-signature"],
    );
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      applied: true,
      status: "completed",
      simulated: true,
    });

    const replay = await postWebhook(
      running,
      delivery.body,
      delivery.headers["x-simulated-signature"],
    );
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ applied: false, status: "completed" });

    const audits = auditLines(sink.text()).filter((line) => line["audit"] === "payment_webhook");
    // No pledge matches this payment, so the replay is flagged for the treasurer as well (story 4.5); nothing is posted.
    expect(audits.map((a) => a["outcome"])).toEqual(["applied", "flagged"]);
    for (const line of audits) expect(line["simulated"]).toBe(true);
  });

  it("refuses a tampered, unsigned or wrongly signed webhook, changes nothing, and audits the refusal", async () => {
    const sink = captureSink();
    running = await startNode({ env: env(), sink });
    const made = await pendingRequest(running);
    const body = completionBody(made.id, "150.50");
    const good = signedWithKey(body);

    const tampered = await postWebhook(running, `${body} `, good);
    expect(tampered.status).toBe(401);
    expect(await tampered.json()).toMatchObject({ problem: "invalid_signature" });

    expect((await postWebhook(running, body)).status).toBe(401);
    expect((await postWebhook(running, body, signedWithKey(body, "ab".repeat(32)))).status).toBe(
      401,
    );

    expect((await simulatedOf(running).payIn.getRequest(made.id))?.status).toBe("pending");
    const refused = auditLines(sink.text()).filter((l) => l["outcome"] === "refused");
    expect(refused.length).toBeGreaterThanOrEqual(3);
    for (const line of refused) expect(line["simulated"]).toBe(true);
  });

  it("acknowledges a validly signed webhook about a payment that was never created, and flags it (story 4.5)", async () => {
    running = await startNode({ env: env(), sink: captureSink() });
    const body = completionBody("pir_999", "150.50");
    const res = await postWebhook(running, body, signedWithKey(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ applied: false, flagged: "unknown_payment" });
  });

  it("routes a signed disbursement event to the pay-out side, applied once", async () => {
    running = await startNode({ env: env(), sink: captureSink() });
    const created = await simulatedOf(running).payOut.createPayout({
      amount: money("ZAR", 450000),
      externalReference: randomEventId(),
      beneficiary: {
        name: "Bulk Foods",
        bankId: "fnb",
        accountNumber: "62000000001",
        accountType: "current",
      },
      beneficiaryReference: "ORDER 42",
      approval: { eventId: randomEventId(), approvers: ["did:key:z6MkTreasurer"] },
    });
    if (!created.ok) throw new Error(created.error.message);
    const delivery = await simulatedOf(running).payOut.settle(created.value.id, "completed");
    const first = await postWebhook(
      running,
      delivery.body,
      delivery.headers["x-simulated-signature"],
    );
    expect(await first.json()).toMatchObject({ applied: true, status: "completed" });
    const replay = await postWebhook(
      running,
      delivery.body,
      delivery.headers["x-simulated-signature"],
    );
    expect(await replay.json()).toMatchObject({ applied: false, status: "completed" });
  });

  it("does not apply a completion that arrives after expiry, and flags it as a late completion", async () => {
    running = await startNode({ env: env(), sink: captureSink() });
    const created = await simulatedOf(running).payIn.createRequest({
      amount: money("ZAR", 9900),
      externalReference: randomEventId(),
      payerReference: "STOKVEL",
      beneficiaryReference: "OCN POOL",
      expireAt: Date.now() + 1000,
    });
    if (!created.ok) throw new Error(created.error.message);
    const delivery = await simulatedOf(running).payIn.settle(created.value.id, "completed");
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const res = await postWebhook(
      running,
      delivery.body,
      delivery.headers["x-simulated-signature"],
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      applied: false,
      status: "expired",
      lateCompletion: true,
    });
    expect(
      simulatedOf(running)
        .lateCompletions()
        .map((l) => l.paymentId),
    ).toEqual([created.value.id]);
  });

  it("keeps a simulated request and its status across a Node restart", async () => {
    const folder = freshFolder();
    const first = await startNode({ env: env(folder), sink: captureSink() });
    const made = await pendingRequest(first);
    const done = await simulatedOf(first).payIn.settle(made.id, "completed");
    await postWebhook(first, done.body, done.headers["x-simulated-signature"]);
    await first.close();

    running = await startNode({ env: env(folder), sink: captureSink() });
    const page = await fetch(`${running.url}/simulated-bank/${made.id}`);
    expect(await page.text()).toContain("completed");
  });

  it("writes no secret value to any log line", async () => {
    const sink = captureSink();
    running = await startNode({ env: env(), sink });
    const made = await pendingRequest(running);
    await fetch(`${running.url}/simulated-bank/${made.id}/approve`, {
      method: "POST",
      redirect: "manual",
    });
    expect(sink.text()).not.toContain(SIM_KEY);
    expect(sink.text()).not.toContain(FAKE_SECRETS.RECORD_MASTER_KEY);
  });
});

// Review items 1 to 5, 8, 9 and 10: guessable ids, form posts, headers, expiry on the page, write failures,
// production refusal, key strength, one banner, and a page that never throws.
describe("the simulated bank page as a capability (review)", () => {
  const sequential = ["pir_1", "pir_2", "pir_0000000000000001"];

  it("refuses production without OCN_NODE_ALLOW_SIMULATED_PAYMENTS, naming the variable", async () => {
    const { OCN_NODE_ALLOW_SIMULATED_PAYMENTS: _omitted, ...rest } = env();
    const error = await startNode({ env: rest, sink: captureSink() }).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).message).toContain("OCN_NODE_ALLOW_SIMULATED_PAYMENTS");
  });

  it("starts in development without the flag, and says simulated", async () => {
    const { OCN_NODE_ALLOW_SIMULATED_PAYMENTS: _omitted, ...rest } = env();
    const sink = captureSink();
    running = await startNode({ env: { ...rest, OCN_NODE_ENVIRONMENT: "development" }, sink });
    expect(sink.text()).toContain("simulated-stitch");
  });

  it("answers a guessed or sequential id with the same 404 as an id that never existed", async () => {
    running = await startNode({ env: env(), sink: captureSink() });
    const unknown = await fetch(`${running.url}/simulated-bank/pir_${"0".repeat(32)}`);
    const unknownText = await unknown.text();
    expect(unknown.status).toBe(404);
    for (const guess of sequential) {
      const page = await fetch(`${running.url}/simulated-bank/${guess}`);
      expect(page.status).toBe(404);
      expect(await page.text()).toBe(unknownText);
      const act = await fetch(`${running.url}/simulated-bank/${guess}/approve`, {
        method: "POST",
        redirect: "manual",
      });
      expect(act.status).toBe(404);
      expect(await act.text()).toBe(unknownText);
    }
  });

  it("never writes a payment id to a log line (the id is the capability)", async () => {
    const sink = captureSink();
    running = await startNode({ env: env(), sink });
    const made = await pendingRequest(running);
    await fetch(`${running.url}/simulated-bank/${made.id}/approve`, {
      method: "POST",
      redirect: "manual",
    });
    expect(sink.text()).not.toContain(made.id);
  });

  it("accepts a plain HTML form post (urlencoded, empty body) and answers 303", async () => {
    running = await startNode({ env: env(), sink: captureSink() });
    const made = await pendingRequest(running);
    const res = await fetch(`${running.url}/simulated-bank/${made.id}/approve`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", "content-length": "0" },
    });
    expect(res.status).toBe(303);
    expect((await simulatedOf(running).payIn.getRequest(made.id))?.status).toBe("completed");
  });

  it("accepts a post with no content type and an empty body", async () => {
    running = await startNode({ env: env(), sink: captureSink() });
    const made = await pendingRequest(running);
    const res = await fetch(`${running.url}/simulated-bank/${made.id}/cancel`, {
      method: "POST",
      redirect: "manual",
    });
    expect(res.status).toBe(303);
  });

  it("sends framing, script, cache and referrer headers on the bank page and its answers", async () => {
    running = await startNode({ env: env(), sink: captureSink() });
    const made = await pendingRequest(running);
    const answers = [
      await fetch(`${running.url}/simulated-bank/${made.id}`),
      await fetch(`${running.url}/simulated-bank/pir_${"0".repeat(32)}`),
    ];
    for (const res of answers) {
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      expect(res.headers.get("content-security-policy")).toBe(
        "frame-ancestors 'none'; default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
      );
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    }
  });

  it("refuses to approve or cancel an expired request on the page, with a plain message and no late flag", async () => {
    running = await startNode({ env: env(), sink: captureSink() });
    const created = await simulatedOf(running).payIn.createRequest({
      amount: money("ZAR", 9900),
      externalReference: randomEventId(),
      payerReference: "STOKVEL",
      beneficiaryReference: "OCN POOL",
      expireAt: Date.now() + 1000,
    });
    if (!created.ok) throw new Error(created.error.message);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    for (const action of ["approve", "cancel"]) {
      const res = await fetch(`${running.url}/simulated-bank/${created.value.id}/${action}`, {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/x-www-form-urlencoded", "content-length": "0" },
      });
      expect(res.status).toBe(409);
      expect(await res.text()).toContain("This payment request has expired.");
    }
    expect(simulatedOf(running).lateCompletions()).toEqual([]);
  });

  it("shows exactly one simulation banner on the page, and never throws on the largest date", async () => {
    running = await startNode({ env: env(), sink: captureSink() });
    const made = await simulatedOf(running).payIn.createRequest({
      amount: money("ZAR", 100),
      externalReference: randomEventId(),
      payerReference: "A",
      beneficiaryReference: "B",
      expireAt: 8.64e15,
    });
    if (!made.ok) throw new Error(made.error.message);
    const page = await fetch(`${running.url}/simulated-bank/${made.value.id}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html.split("SIMULATED STITCH.").length - 1).toBe(1);
    const missing = await fetch(`${running.url}/simulated-bank/pir_x`);
    expect((await missing.text()).split("SIMULATED STITCH.").length - 1).toBe(1);
  });

  it("answers 503, not 500, and changes nothing when the state cannot be written", async () => {
    const folder = freshFolder();
    running = await startNode({ env: env(folder), sink: captureSink() });
    const made = await pendingRequest(running);
    const delivery = await simulatedOf(running).payIn.settle(made.id, "completed");
    mkdirSync(join(folder, `${PAYMENTS_STATE_FILE}.tmp`));
    const res = await postWebhook(
      running,
      delivery.body,
      delivery.headers["x-simulated-signature"],
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ problem: "state_unwritten" });
    const approve = await fetch(`${running.url}/simulated-bank/${made.id}/approve`, {
      method: "POST",
      redirect: "manual",
    });
    expect(approve.status).toBe(503);
    expect((await simulatedOf(running).payIn.getRequest(made.id))?.status).toBe("pending");
    rmSync(join(folder, `${PAYMENTS_STATE_FILE}.tmp`), { recursive: true });
    const retry = await postWebhook(
      running,
      delivery.body,
      delivery.headers["x-simulated-signature"],
    );
    expect(await retry.json()).toMatchObject({ applied: true, status: "completed" });
  });

  it("refuses a webhook key with four or fewer distinct hex characters", async () => {
    for (const weak of ["0123".repeat(16), "ab".repeat(32)]) {
      const error = await startNode({
        env: env(undefined, { SIMULATED_WEBHOOK_SECRET: weak }),
        sink: captureSink(),
      }).then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).keys).toEqual(["SIMULATED_WEBHOOK_SECRET"]);
      expect((error as ConfigError).message).not.toContain(weak);
    }
  });
});
