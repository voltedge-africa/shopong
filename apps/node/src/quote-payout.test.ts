// The Node's record with a quote and then a payment for it (story 4.7, a quote sent from a phone). Real HTTP and a real
// record in a temp folder: the creator posts `quote.added`, then `payment.payout` for the same order and supplier. Both
// must be accepted, and the view must hold the quote under the key the payment is checked against.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkQuote,
  createCommunity,
  quoteJson,
  quoteKey,
  signRequest,
  type RequestParts,
} from "@shopong/community";
import { createEvent, webCryptoSha512, type EventEnvelope } from "@shopong/events";
import { afterAll, afterEach, describe, expect, it } from "vite-plus/test";
import { startNode, type RunningNode } from "./node.ts";
import { captureSink, FAKE_SECRETS } from "./testing/capture.ts";
import { phone, randomHex, T0, type Phone } from "./testing/community.ts";

const folders: string[] = [];
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});
let running: RunningNode | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

async function call(
  node: RunningNode,
  signer: Phone,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const text = body === undefined ? "" : JSON.stringify(body);
  const parts: RequestParts = {
    method,
    path,
    body: text,
    nonce: randomHex(16),
    time: Date.now(),
    actor: signer.did,
  };
  const signed = await signRequest(signer.auth, parts, webCryptoSha512);
  if (!signed.ok) throw new Error(signed.error.message);
  const res = await fetch(`${node.url}${path}`, {
    method,
    headers: {
      ...(signed.value as unknown as Record<string, string>),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: text }),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe("a quote and a payment for it, sent to the Node's record [S-4.7 quote sync]", () => {
  it("the Node accepts the quote, then the payment for it, and holds the quote under the payment's key", async () => {
    const folder = mkdtempSync(join(tmpdir(), "ocn-quote-payout-"));
    folders.push(folder);
    running = await startNode({
      env: {
        OCN_NODE_PORT: "0",
        OCN_NODE_DATA_DIR: folder,
        RECORD_MASTER_KEY: FAKE_SECRETS.RECORD_MASTER_KEY,
      },
      sink: captureSink(),
    });
    const node = running;
    const hub = node.hub!;
    const creator = await phone();
    const made = await createCommunity(
      creator.deps,
      await hub.recordOf(creator.did),
      "Stokvel",
      T0,
    );
    if (!made.ok) throw new Error(made.error.message);
    await hub.register(made.value);
    const key = made.value.key;

    const quote = checkQuote({
      supplier: "Acme",
      order: "pay1",
      lines: [{ item: "Maize meal", unit: "pack", packSize: 1, pricePerPackCents: 10000 }],
      delivery: { feeCents: 0, days: 0 },
    });
    if (!quote.ok) throw new Error("fixture");
    const quoteEvent = createEvent({
      type: "quote.added",
      space: key,
      actor: creator.did,
      proof: [],
      claimedAt: Date.now(),
      nonce: randomHex(16),
      payload: quoteJson(quote.value),
    } as never) as EventEnvelope;
    const sentQuote = await call(node, creator, "POST", `/spaces/${key}/events`, quoteEvent);
    expect(sentQuote.status).toBe(200);
    const quoteId = String(sentQuote.json.id);
    await hub.catchUp(key);
    const view = (await hub.indexedView(key))!;
    expect(await view.get(`rejected/${quoteId}`)).toBeUndefined();
    expect(await view.get(quoteKey("pay1", "Acme"))).toBeDefined();

    const payoutEvent = createEvent({
      type: "payment.payout",
      space: key,
      actor: creator.did,
      proof: [],
      claimedAt: Date.now(),
      nonce: randomHex(16),
      payload: {
        order: "pay1",
        supplier: "Acme",
        amount: { currency: "ZAR", minor: 100000 },
        recommendation: "clear",
        bank: "12".repeat(64),
      },
    } as never) as EventEnvelope;
    const sentPayout = await call(node, creator, "POST", `/spaces/${key}/events`, payoutEvent);
    expect(sentPayout.status).toBe(200);
    await hub.catchUp(key);
    const after = (await hub.indexedView(key))!;
    expect(await after.get(`rejected/${String(sentPayout.json.id)}`)).toBeUndefined();
    expect(await after.get(`payouts/${String(sentPayout.json.id)}`)).toBeDefined();
  });
});
