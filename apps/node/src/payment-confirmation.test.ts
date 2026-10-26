// Confirmation of simulated payments on the Node (story 4.5): the verified webhook, the three writes in order, the
// security and money rows, the reconciler, the treasurer's list, and the books on the production SQLite file.
// SIMULATED: the processor is the simulated Stitch (story 4.4). Every surface these tests read says so.
import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryLedger } from "@shopong/adapters-memory";
import {
  encodeProof,
  issueInvitation,
  newCommunityKey,
  signRequest,
  type RequestParts,
} from "@shopong/community";
import { createEvent, eventIdOf, webCryptoSha512, type EventEnvelope } from "@shopong/events";
import { memberLiabilityOf, poolAccountOf } from "@shopong/ledger-sqlite";
import {
  err,
  money,
  type Ledger,
  type PaymentRequest,
  type PostError,
  type Result,
} from "@shopong/ports";
import { afterAll, afterEach, describe, expect, it } from "vite-plus/test";
import { PAYMENTS_STATE_FILE } from "./payments.ts";
import { startNode, type RunningNode } from "./node.ts";
import { SIMULATED_POOL_NOTE } from "./pool-routes.ts";
import { memberIdOf } from "./pool-read.ts";
import { paymentEventOf, PAYMENT_COMPLETED, PAYMENT_FAILED } from "./payment-confirmation.ts";
import { captureSink, FAKE_SECRETS } from "./testing/capture.ts";
import { phone, randomHex, type Phone } from "./testing/community.ts";
import { randomEventId } from "@shopong/ports-contract";

const folders: string[] = [];
const freshFolder = (): string => {
  const folder = mkdtempSync(join(tmpdir(), "ocn-confirm-"));
  folders.push(folder);
  return folder;
};
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

let running: RunningNode | undefined;
afterEach(async () => {
  await running?.close().catch(() => undefined);
  running = undefined;
});

const SIM_KEY = FAKE_SECRETS.SIMULATED_WEBHOOK_SECRET;
const MASTER_KEY = Buffer.from(FAKE_SECRETS.RECORD_MASTER_KEY, "hex");

function env(folder: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    OCN_NODE_PORT: "0",
    OCN_NODE_DATA_DIR: folder,
    RECORD_MASTER_KEY: FAKE_SECRETS.RECORD_MASTER_KEY,
    OCN_NODE_PAYMENTS_ENABLED: "true",
    OCN_NODE_LEDGER_ENABLED: "true",
    SIMULATED_WEBHOOK_SECRET: SIM_KEY,
    OCN_NODE_ALLOW_SIMULATED_PAYMENTS: "true",
    ...extra,
  };
}

/** Starts a Node with its own folder; `ledger` replaces the SQLite books when a test needs to break them. */
async function start(
  folder = freshFolder(),
  options: {
    ledger?: Ledger;
    faults?: {
      beforeRecord?: (type: string) => void;
      failRecordWrite?: (type: string) => boolean;
    };
    extra?: Record<string, string>;
  } = {},
): Promise<RunningNode> {
  running = await startNode({
    env: env(folder, options.extra),
    sink: captureSink(),
    ...(options.ledger === undefined ? {} : { ledger: options.ledger }),
    ...(options.faults === undefined ? {} : { faults: options.faults }),
  });
  return running;
}

type Reply = { status: number; json: Record<string, unknown> };

async function call(
  node: RunningNode,
  signer: Phone | undefined,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<Reply> {
  const text = body === undefined ? "" : JSON.stringify(body);
  let headers: Record<string, string> = {};
  if (signer !== undefined) {
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
    headers = signed.value as unknown as Record<string, string>;
  }
  const res = await fetch(`${node.url}${path}`, {
    method,
    headers: {
      ...headers,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: text }),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const randomKey = (): string => newCommunityKey((n) => crypto.getRandomValues(new Uint8Array(n)));

async function eventOf(
  key: string,
  who: Phone,
  type: string,
  payload: Record<string, unknown>,
  proof: string[] = [],
): Promise<unknown> {
  return createEvent({
    type,
    space: key,
    actor: who.did,
    proof,
    claimedAt: Date.now(),
    nonce: randomHex(16),
    payload,
  } as never);
}

async function post(node: RunningNode, who: Phone, key: string, event: unknown): Promise<Reply> {
  let last: Reply = { status: 0, json: {} };
  for (let i = 0; i < 100; i++) {
    last = await call(node, who, "POST", `/spaces/${key}/events`, event);
    if (last.status !== 403 || last.json.problem !== "not_writable") return last;
    await new Promise((r) => setTimeout(r, 50));
  }
  return last;
}

/** The creator makes a community and admits one member (a treasurer's counterpart) who joins. */
async function community(node: RunningNode) {
  const creator = await phone();
  const key = randomKey();
  expect((await call(node, creator, "POST", "/communities", { key })).status).toBe(200);
  const founder = await eventOf(key, creator, "member.joined", { invitation: "founder" });
  expect((await post(node, creator, key, founder)).status).toBe(200);
  const joiner = await admit(node, creator, key);
  return { creator, joiner, key };
}

async function admit(node: RunningNode, creator: Phone, key: string): Promise<Phone> {
  const joiner = await phone();
  const issued = await issueInvitation({
    auth: creator.auth,
    creator: creator.did,
    spaceKey: key,
    invitee: joiner.did,
    now: Date.now(),
  });
  if (!issued.ok) throw new Error(issued.error.message);
  const invited = await eventOf(key, creator, "member.invited", {
    invitation: issued.value.id,
    invitee: joiner.did,
    expiresAt: issued.value.expiresAt,
  });
  expect((await post(node, creator, key, invited)).status).toBe(200);
  expect(
    (
      await call(node, joiner, "POST", `/communities/${key}/members`, {
        invitation: issued.value.link,
      })
    ).status,
  ).toBe(200);
  const joined = await eventOf(key, joiner, "member.joined", { invitation: issued.value.id }, [
    encodeProof(issued.value.token),
  ]);
  expect((await post(node, joiner, key, joined)).status).toBe(200);
  return joiner;
}

/** A member's pledge in the record, and the simulated payment request that pays it. */
async function pledge(node: RunningNode, member: Phone, key: string, minor = 50_000) {
  const event = await eventOf(key, member, "pledge.created", {
    amountMinor: minor,
    currency: "ZAR",
  });
  const reply = await post(node, member, key, event);
  expect(reply.status).toBe(200);
  const id = reply.json.id as string;
  const created = await simulated(node).payIn.createRequest({
    amount: money("ZAR", minor),
    externalReference: id as never,
    payerReference: "STOKVEL",
    beneficiaryReference: "OCN POOL",
    expireAt: Date.now() + 86_400_000,
  });
  if (!created.ok) throw new Error(created.error.message);
  return { request: created.value, pledgeId: id };
}

function simulated(node: RunningNode) {
  if (node.payments === undefined) throw new Error("test setup: payments are not running");
  return node.payments;
}

function completionBody(
  id: string,
  quantity: string,
  outcome = "PaymentInitiationRequestCompleted",
) {
  return JSON.stringify({
    type: outcome,
    data: {
      paymentInitiationRequest: {
        id,
        externalReference: "x",
        amount: { quantity, currency: "ZAR" },
      },
    },
  });
}

/** Signs with the Node's key using Node's own crypto, independent of the adapter's code. */
function signed(body: string, key: string = SIM_KEY): string {
  return createHmac("sha512", Buffer.from(key, "hex")).update(body).digest("hex");
}

async function deliver(node: RunningNode, body: string, signature?: string): Promise<Reply> {
  const res = await fetch(`${node.url}/webhooks/payments`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(signature === undefined ? {} : { "x-simulated-signature": signature }),
    },
    body,
  });
  return {
    status: res.status,
    json: (await res.json().catch(() => ({}))) as Record<string, unknown>,
  };
}

/** A verified delivery of `outcome` for a request, as the simulated processor would send it. */
async function verified(
  node: RunningNode,
  request: PaymentRequest,
  outcome: "completed" | "failed" | "cancelled",
) {
  const d = await simulated(node).payIn.settle(request.id, outcome);
  return deliver(node, d.body, d.headers["x-simulated-signature"]);
}

/** The books' pool balance in cents, and the record's events of a type for a community. */
async function poolMinor(node: RunningNode, key: string): Promise<number> {
  return (await node.ledger!.balance(poolAccountOf(key), "ZAR")).balance.minor;
}

async function recordCount(node: RunningNode, key: string, type: string): Promise<number> {
  return (await node.hub!.journalOf(key)).filter((e) => e.event.type === type).length;
}

/** The event id a completion or failure of this pledge has (the same derivation the Node uses). */
async function bookedId(
  node: RunningNode,
  key: string,
  who: Phone,
  pledgeId: string,
  minor: number,
  type: typeof PAYMENT_COMPLETED = PAYMENT_COMPLETED,
) {
  const creator = node.hub!.creatorOf(key)!;
  const event = paymentEventOf({
    type,
    communityKey: key,
    creator,
    nodeIdentity: node.nodeIdentity!,
    externalReference: pledgeId,
    memberId: memberIdOf(MASTER_KEY, key, who.did),
    amountMinor: minor,
    currency: "ZAR",
  });
  return eventIdOf(event, webCryptoSha512);
}

async function checkingOf(node: RunningNode, who: Phone, key: string): Promise<Reply> {
  return call(node, who, "GET", `/communities/${key}/needs-checking`);
}

describe("a verified completion (story 4.5, the Node's path)", () => {
  it("posts once to the books, records one payment.completed, and answers 200", async () => {
    const node = await start();
    const { creator, joiner, key } = await community(node);
    const { request, pledgeId } = await pledge(node, joiner, key);

    const first = await verified(node, request, "completed");
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({ applied: true, status: "completed", simulated: true });

    expect(await poolMinor(node, key)).toBe(50_000);
    expect(await recordCount(node, key, PAYMENT_COMPLETED)).toBe(1);
    expect(await recordCount(node, key, "ledger.posted")).toBe(1);
    const id = await bookedId(node, key, joiner, pledgeId, 50_000);
    expect(await node.ledger!.findByIdempotencyKey(id)).toBeDefined();
    // The record accepted the payment event: apply did not reject it (a rejection is kept under `rejected/`).
    const view = await node.hub!.indexedView(key);
    expect(
      await view!.get(`rejected/${await bookedId(node, key, joiner, pledgeId, 50_000)}`),
    ).toBeUndefined();
    expect(creator.did).toBeDefined();
  });

  it("a duplicate delivery is harmless: one books post, one record event, applied false both times", async () => {
    const node = await start();
    const { key, joiner } = await community(node);
    const { request } = await pledge(node, joiner, key);
    const d = await simulated(node).payIn.settle(request.id, "completed");
    const sig = d.headers["x-simulated-signature"];

    const first = await deliver(node, d.body, sig);
    const replay = await deliver(node, d.body, sig);
    expect(first.json).toMatchObject({ applied: true });
    expect(replay.status).toBe(200);
    expect(replay.json).toMatchObject({ applied: false, status: "completed" });
    expect(await poolMinor(node, key)).toBe(50_000);
    expect(await recordCount(node, key, PAYMENT_COMPLETED)).toBe(1);
    expect(await recordCount(node, key, "ledger.posted")).toBe(1);
  });
});

describe("security and money rows (story 4.5)", () => {
  it("refuses a bad or missing signature with 401, and writes nothing", async () => {
    const node = await start();
    const { key, joiner } = await community(node);
    const { request, pledgeId } = await pledge(node, joiner, key);
    const body = completionBody(request.id, "500.00");

    expect((await deliver(node, body, signed(body, "ab".repeat(32)))).status).toBe(401);
    const missing = await deliver(node, body);
    expect(missing.status).toBe(401);
    expect(missing.json).toMatchObject({ problem: "invalid_signature" });
    expect(JSON.stringify(missing.json)).not.toContain(request.id);
    expect(await poolMinor(node, key)).toBe(0);
    expect(await recordCount(node, key, PAYMENT_COMPLETED)).toBe(0);
    expect((await simulated(node).payIn.getRequest(request.id))?.status).toBe("pending");
    expect(pledgeId).toBeDefined();
  });

  it("refuses a wrong amount: nothing posted, flagged for the treasurer in plain words", async () => {
    const node = await start();
    const { creator, joiner, key } = await community(node);
    const { request } = await pledge(node, joiner, key);
    const body = completionBody(request.id, "499.00");

    const res = await deliver(node, body, signed(body));
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ applied: false, flagged: "amount_mismatch" });
    expect(await poolMinor(node, key)).toBe(0);
    expect(await recordCount(node, key, PAYMENT_COMPLETED)).toBe(0);
    expect((await simulated(node).payIn.getRequest(request.id))?.status).toBe("pending");

    const list = await checkingOf(node, creator, key);
    expect(list.status).toBe(200);
    const flags = list.json.flags as { kind: string; text: string }[];
    expect(flags.map((f) => f.kind)).toEqual(["amount_mismatch"]);
    expect(flags[0]!.text).toContain("(simulated)");
  });

  it("acknowledges an unknown request with 200, posts nothing, and flags it for the treasurer", async () => {
    const node = await start();
    const { creator, key } = await community(node);
    const body = completionBody("pir_" + "0".repeat(32), "500.00");

    const res = await deliver(node, body, signed(body));
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ applied: false, flagged: "unknown_payment", simulated: true });
    expect(await poolMinor(node, key)).toBe(0);

    const list = await checkingOf(node, creator, key);
    const flags = list.json.flags as { kind: string; text: string }[];
    expect(flags.map((f) => f.kind)).toContain("unknown_payment");
    for (const flag of flags) expect(flag.text).toContain("(simulated)");
    expect(JSON.stringify(list.json)).not.toContain("pir_");
  });

  it("does not post a completion that arrives after a failure: flagged as a conflict, status unchanged", async () => {
    const node = await start();
    const { creator, joiner, key } = await community(node);
    const { request } = await pledge(node, joiner, key);

    const failed = await verified(node, request, "failed");
    expect(failed.json).toMatchObject({ applied: true, status: "failed" });
    expect(await recordCount(node, key, "payment.failed")).toBe(1);

    const done = await verified(node, request, "completed");
    expect(done.status).toBe(200);
    expect(done.json).toMatchObject({
      applied: false,
      status: "failed",
      flagged: "completed_after_ended",
    });
    expect(await poolMinor(node, key)).toBe(0);
    expect(await recordCount(node, key, PAYMENT_COMPLETED)).toBe(0);
    expect((await simulated(node).payIn.getRequest(request.id))?.status).toBe("failed");

    const flags = (await checkingOf(node, creator, key)).json.flags as { kind: string }[];
    expect(flags.map((f) => f.kind)).toContain("completed_after_ended");
  });

  it("refuses a payment outcome written by a phone: the record refuses node-only types", async () => {
    const node = await start();
    const { joiner, key } = await community(node);
    const forged = await eventOf(key, joiner, PAYMENT_COMPLETED, {
      by: joiner.did,
      externalReference: randomEventId(),
      memberId: randomHex(64),
      amountMinor: 50_000,
      currency: "ZAR",
      status: "completed",
    });
    const reply = await post(node, joiner, key, forged);
    expect(reply.status).toBe(403);
    expect(reply.json.problem).toBe("node_only");
    expect(await recordCount(node, key, PAYMENT_COMPLETED)).toBe(0);
  });
});

describe("crashes, failures and restarts (story 4.5)", () => {
  it("a crash after the books and before the record is repaired by a redelivery after a restart", async () => {
    const folder = freshFolder();
    let crash = true;
    const first = await start(folder, {
      faults: {
        beforeRecord: (type) => {
          if (crash && type === PAYMENT_COMPLETED)
            throw new Error("simulated crash before the record");
        },
      },
    });
    const { joiner, key } = await community(first);
    const { request } = await pledge(first, joiner, key);
    const d = await simulated(first).payIn.settle(request.id, "completed");
    const sig = d.headers["x-simulated-signature"];

    const crashed = await deliver(first, d.body, sig);
    expect(crashed.status).toBe(503);
    expect(crashed.json).toMatchObject({ problem: "books_written" });
    expect(await poolMinor(first, key)).toBe(50_000);
    expect(await recordCount(first, key, PAYMENT_COMPLETED)).toBe(0);
    expect((await simulated(first).payIn.getRequest(request.id))?.status).toBe("pending");

    // The reconciler sees the books posted while the bank still shows pending, and says so without repairing anything.
    const items = await first.checking!.runNow();
    expect(items.map((i) => i.kind)).toEqual(["books_not_paid_at_bank"]);
    expect(await recordCount(first, key, PAYMENT_COMPLETED)).toBe(0);
    expect(await poolMinor(first, key)).toBe(50_000);
    await first.close();
    running = undefined;

    crash = false;
    const second = await start(folder);
    const redelivered = await deliver(second, d.body, sig);
    expect(redelivered.status).toBe(200);
    expect(redelivered.json).toMatchObject({ applied: true, status: "completed" });
    expect(await poolMinor(second, key)).toBe(50_000);
    expect(await recordCount(second, key, PAYMENT_COMPLETED)).toBe(1);
    expect(await recordCount(second, key, "ledger.posted")).toBe(1);
  });

  it("a books write that fails is not acknowledged: 503, and the bank's status and the record stay as they were", async () => {
    const inner = new MemoryLedger({ clock: { now: () => Date.now() } });
    let failing = true;
    const flaky: Ledger = {
      configureAccount: (a, o) => inner.configureAccount(a, o),
      findByIdempotencyKey: (k) => inner.findByIdempotencyKey(k),
      balance: (a, c) => inner.balance(a, c),
      trialBalance: () => inner.trialBalance(),
      post: async (request): Promise<Result<never, PostError>> => {
        if (failing) return err("invalid_request", "the books are unavailable");
        return (await inner.post(request)) as never;
      },
    } as Ledger;
    const node = await start(freshFolder(), { ledger: flaky });
    const { joiner, key } = await community(node);
    const { request } = await pledge(node, joiner, key);
    const d = await simulated(node).payIn.settle(request.id, "completed");

    const res = await deliver(node, d.body, d.headers["x-simulated-signature"]);
    expect(res.status).toBe(503);
    expect(res.json).toMatchObject({ problem: "state_unwritten" });
    expect(String(res.json.message)).toContain("(simulated)");
    expect(await recordCount(node, key, PAYMENT_COMPLETED)).toBe(0);
    expect((await simulated(node).payIn.getRequest(request.id))?.status).toBe("pending");

    failing = false;
    const retry = await deliver(node, d.body, d.headers["x-simulated-signature"]);
    expect(retry.json).toMatchObject({ applied: true, status: "completed" });
    expect(await recordCount(node, key, PAYMENT_COMPLETED)).toBe(1);
  });
});

describe("the reconciler (story 4.5)", () => {
  it("runs once at start and lists a books posting that has no record, changing nothing", async () => {
    const folder = freshFolder();
    const node = await start(folder);
    const { joiner, key } = await community(node);
    const { request, pledgeId } = await pledge(node, joiner, key);
    // The bank says paid; the books hold the completion, but the record never mirrored it (written straight to the ledger).
    await simulated(node).payIn.ingestWebhook(
      await simulated(node).payIn.settle(request.id, "completed"),
    );
    const id = await bookedId(node, key, joiner, pledgeId, 50_000);
    const memberId = memberIdOf(MASTER_KEY, key, joiner.did);
    const posted = await node.ledger!.post({
      idempotencyKey: id,
      description: "Pay-in confirmed (simulated Stitch)",
      entries: [
        { account: poolAccountOf(key), direction: "debit", amount: money("ZAR", 50_000) },
        {
          account: memberLiabilityOf(key, memberId),
          direction: "credit",
          amount: money("ZAR", 50_000),
        },
      ],
    });
    expect(posted.ok).toBe(true);

    await node.checking!.lastRun;
    const before = await recordCount(node, key, "ledger.posted");
    const items = await node.checking!.runNow();
    expect(items.map((i) => i.kind)).toContain("books_not_in_record");
    expect(await recordCount(node, key, "ledger.posted")).toBe(before);
    expect(await poolMinor(node, key)).toBe(50_000);
    expect(items.every((i) => i.text.includes("(simulated)"))).toBe(true);
  });

  it("lists a bank payment the books do not have, and the treasurer sees it on the list", async () => {
    const node = await start();
    const { creator, joiner, key } = await community(node);
    const { request } = await pledge(node, joiner, key);
    const d = await simulated(node).payIn.settle(request.id, "completed");
    // The provider says paid; the Node has not been told (no webhook yet), so the books do not have it.
    await simulated(node).payIn.ingestWebhook(d);

    const items = await node.checking!.runNow();
    expect(items.map((i) => i.kind)).toEqual(
      expect.arrayContaining(["bank_paid_not_in_books", "bank_paid_not_in_record"]),
    );
    const list = await checkingOf(node, creator, key);
    const reconciled = list.json.reconciled as { kind: string; text: string }[];
    expect(reconciled.map((i) => i.kind)).toContain("bank_paid_not_in_books");
    expect(await poolMinor(node, key)).toBe(0);
  });

  it("lists a payment in the record that the bank does not show as paid", async () => {
    const node = await start();
    const { joiner, key } = await community(node);
    const { request, pledgeId } = await pledge(node, joiner, key);
    // The record says paid (a payment.completed the Node wrote), but the simulated bank still says pending.
    await node.hub!.mirror(
      key,
      paymentEventOf({
        type: PAYMENT_COMPLETED,
        communityKey: key,
        creator: node.hub!.creatorOf(key)!,
        nodeIdentity: node.nodeIdentity!,
        externalReference: pledgeId,
        memberId: memberIdOf(MASTER_KEY, key, joiner.did),
        amountMinor: 50_000,
        currency: "ZAR",
      }) as EventEnvelope,
    );
    const items = await node.checking!.runNow();
    expect(items.map((i) => i.kind)).toContain("record_paid_not_at_bank");
    expect((await simulated(node).payIn.getRequest(request.id))?.status).toBe("pending");
  });
});

describe("the treasurer's list (story 4.5)", () => {
  it("is for treasurers: the creator sees it, a member who is not a treasurer and a stranger do not", async () => {
    const node = await start();
    const { creator, joiner, key } = await community(node);
    const stranger = await phone();

    expect((await checkingOf(node, creator, key)).status).toBe(200);
    const notTreasurer = await checkingOf(node, joiner, key);
    expect(notTreasurer.status).toBe(403);
    expect(notTreasurer.json.problem).toBe("not_treasurer");
    expect((await checkingOf(node, stranger, key)).status).toBe(403);
    expect((await checkingOf(node, undefined as never, key)).status).toBe(401);
  });
});

describe("the books on the production SQLite file (story 4.5)", () => {
  it("opens the ledger file in the data folder, and the pool read answers 200, not 503", async () => {
    const folder = freshFolder();
    const node = await start(folder);
    const { creator, key } = await community(node);
    expect(existsSync(join(folder, "ledger.sqlite"))).toBe(true);
    const pool = await call(node, creator, "GET", `/communities/${key}/pool`);
    expect(pool.status).toBe(200);
    expect(JSON.stringify(await (await fetch(`${node.url}/health`)).json())).toContain("sqlite");
  });

  it("sets up a new community's chart when it is made", async () => {
    const inner = new MemoryLedger({ clock: { now: () => Date.now() } });
    let configured = 0;
    const counting: Ledger = {
      configureAccount: async (a, o) => {
        configured += 1;
        return inner.configureAccount(a, o);
      },
      findByIdempotencyKey: (k) => inner.findByIdempotencyKey(k),
      balance: (a, c) => inner.balance(a, c),
      trialBalance: () => inner.trialBalance(),
      post: (r) => inner.post(r),
    } as Ledger;
    const node = await start(freshFolder(), { ledger: counting });
    await community(node);
    expect(configured).toBeGreaterThanOrEqual(3);
  });

  it("refuses payments without the record at start, naming the reason", async () => {
    await expect(
      startNode({
        env: env(freshFolder(), { OCN_NODE_RECORD_ENABLED: "false" }),
        sink: captureSink(),
      }),
    ).rejects.toThrow(/payments need the record/u);
  });
});

describe("races, write order and the true state (review items 2 to 8)", () => {
  it("two deliveries for one request at once: exactly one applies, the other is flagged as a conflict", async () => {
    const node = await start();
    const { creator, joiner, key } = await community(node);
    const { request } = await pledge(node, joiner, key);
    const paid = await simulated(node).payIn.settle(request.id, "completed");
    const broke = await simulated(node).payIn.settle(request.id, "failed");

    const [a, b] = await Promise.all([
      deliver(node, paid.body, paid.headers["x-simulated-signature"]),
      deliver(node, broke.body, broke.headers["x-simulated-signature"]),
    ]);
    expect([a.json.applied, b.json.applied].filter((x) => x === true)).toHaveLength(1);
    const status = (await simulated(node).payIn.getRequest(request.id))?.status;
    const kinds = ((await checkingOf(node, creator, key)).json.flags as { kind: string }[]).map(
      (f) => f.kind,
    );
    const conflicts = kinds.filter(
      (k) => k === "failed_after_completed" || k === "completed_after_ended",
    );
    expect(conflicts).toHaveLength(1);
    if (status === "completed") {
      expect(await poolMinor(node, key)).toBe(50_000);
      expect(await recordCount(node, key, PAYMENT_COMPLETED)).toBe(1);
      expect(await recordCount(node, key, PAYMENT_FAILED)).toBe(0);
    } else {
      expect(status).toBe("failed");
      expect(await poolMinor(node, key)).toBe(0);
      expect(await recordCount(node, key, PAYMENT_COMPLETED)).toBe(0);
      expect(await recordCount(node, key, PAYMENT_FAILED)).toBe(1);
    }
  });

  it("a failure that arrives while a completion is writing the books waits its turn: one outcome, the other flagged", async () => {
    const inner = new MemoryLedger({ clock: { now: () => Date.now() } });
    let nodeRef: RunningNode | undefined;
    let fireFailure: (() => Promise<Reply>) | undefined;
    let failedResult: Promise<Reply> | undefined;
    const interleaving: Ledger = {
      configureAccount: (a, o) => inner.configureAccount(a, o),
      findByIdempotencyKey: (k) => inner.findByIdempotencyKey(k),
      balance: (a, c) => inner.balance(a, c),
      trialBalance: () => inner.trialBalance(),
      post: (r) => {
        // Inside the completion's books write: start the failure now, without waiting for it.
        if (fireFailure !== undefined) {
          failedResult = fireFailure();
          fireFailure = undefined;
        }
        return inner.post(r);
      },
    } as Ledger;
    const node = await start(freshFolder(), { ledger: interleaving });
    nodeRef = node;
    expect(nodeRef).toBeDefined();
    const { creator, joiner, key } = await community(node);
    const { request } = await pledge(node, joiner, key);
    const paid = await simulated(node).payIn.settle(request.id, "completed");
    const broke = await simulated(node).payIn.settle(request.id, "failed");
    fireFailure = () => deliver(node, broke.body, broke.headers["x-simulated-signature"]);

    const completed = await deliver(node, paid.body, paid.headers["x-simulated-signature"]);
    const failed = await failedResult!;
    expect([completed.json.applied, failed.json.applied].filter((x) => x === true)).toHaveLength(1);
    expect(completed.json).toMatchObject({ applied: true, status: "completed" });
    expect(failed.json).toMatchObject({
      applied: false,
      status: "completed",
      flagged: "failed_after_completed",
    });
    expect(await poolMinor(node, key)).toBe(50_000);
    expect(await recordCount(node, key, PAYMENT_COMPLETED)).toBe(1);
    expect(await recordCount(node, key, PAYMENT_FAILED)).toBe(0);
    expect(creator.did).toBeDefined();
  });

  it("a cancellation that lands during the awaits before the books is caught by the re-read: nothing is posted", async () => {
    const inner = new MemoryLedger({ clock: { now: () => Date.now() } });
    let nodeRef: RunningNode | undefined;
    let cancelNow = false;
    let requestId = "";
    const racing: Ledger = {
      configureAccount: async (a, o) => {
        if (cancelNow) {
          cancelNow = false;
          await nodeRef!.payments!.payIn.cancelRequest(requestId);
        }
        return inner.configureAccount(a, o);
      },
      findByIdempotencyKey: (k) => inner.findByIdempotencyKey(k),
      balance: (a, c) => inner.balance(a, c),
      trialBalance: () => inner.trialBalance(),
      post: (r) => inner.post(r),
    } as Ledger;
    const node = await start(freshFolder(), { ledger: racing });
    nodeRef = node;
    const { creator, joiner, key } = await community(node);
    const { request } = await pledge(node, joiner, key);
    requestId = request.id;
    cancelNow = true;
    const d = await simulated(node).payIn.settle(request.id, "completed");

    const res = await deliver(node, d.body, d.headers["x-simulated-signature"]);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      applied: false,
      status: "cancelled",
      flagged: "completed_after_ended",
    });
    expect(await poolMinor(node, key)).toBe(0);
    expect(await recordCount(node, key, PAYMENT_COMPLETED)).toBe(0);
    expect(creator.did).toBeDefined();
  });

  it("an ingest that throws after a failure is not recorded: the record never says failed while the provider says pending", async () => {
    const folder = freshFolder();
    const node = await start(folder);
    const { joiner, key } = await community(node);
    const { request } = await pledge(node, joiner, key);
    const stateTmp = join(folder, `${PAYMENTS_STATE_FILE}.tmp`);
    mkdirSync(stateTmp);
    const d = await simulated(node).payIn.settle(request.id, "failed");

    const res = await deliver(node, d.body, d.headers["x-simulated-signature"]);
    expect(res.status).toBe(503);
    expect(res.json).toMatchObject({ problem: "state_unwritten" });
    expect(await recordCount(node, key, PAYMENT_FAILED)).toBe(0);
    expect((await simulated(node).payIn.getRequest(request.id))?.status).toBe("pending");

    rmSync(stateTmp, { recursive: true });
    const again = await deliver(node, d.body, d.headers["x-simulated-signature"]);
    expect(again.json).toMatchObject({ applied: true, status: "failed" });
    expect(await recordCount(node, key, PAYMENT_FAILED)).toBe(1);
  });

  it("a failed record write for a completion is not acknowledged (503 books_written), and a redelivery repairs it", async () => {
    let failing = true;
    const node = await start(freshFolder(), {
      faults: { failRecordWrite: (type) => failing && type === PAYMENT_COMPLETED },
    });
    const { joiner, key } = await community(node);
    const { request } = await pledge(node, joiner, key);
    const d = await simulated(node).payIn.settle(request.id, "completed");
    const sig = d.headers["x-simulated-signature"];

    const refused = await deliver(node, d.body, sig);
    expect(refused.status).toBe(503);
    expect(refused.json).toMatchObject({ problem: "books_written" });
    expect(String(refused.json.message)).toContain("(simulated)");
    expect(await poolMinor(node, key)).toBe(50_000);
    expect(await recordCount(node, key, PAYMENT_COMPLETED)).toBe(0);
    expect((await simulated(node).payIn.getRequest(request.id))?.status).toBe("pending");

    failing = false;
    const repaired = await deliver(node, d.body, sig);
    expect(repaired.status).toBe(200);
    expect(repaired.json).toMatchObject({ applied: true, status: "completed" });
    expect(await poolMinor(node, key)).toBe(50_000);
    expect(await recordCount(node, key, PAYMENT_COMPLETED)).toBe(1);
  });

  it("a status that cannot be saved after the record reports record_written, and a redelivery finishes it", async () => {
    const folder = freshFolder();
    let breakState = true;
    const stateTmp = join(folder, `${PAYMENTS_STATE_FILE}.tmp`);
    const node = await start(folder, {
      faults: {
        failRecordWrite: (type) => {
          if (breakState && type === PAYMENT_COMPLETED) mkdirSync(stateTmp);
          return false;
        },
      },
    });
    const { joiner, key } = await community(node);
    const { request } = await pledge(node, joiner, key);
    const d = await simulated(node).payIn.settle(request.id, "completed");
    const sig = d.headers["x-simulated-signature"];

    const stopped = await deliver(node, d.body, sig);
    expect(stopped.status).toBe(503);
    expect(stopped.json).toMatchObject({ problem: "record_written" });
    expect(await recordCount(node, key, PAYMENT_COMPLETED)).toBe(1);
    expect((await simulated(node).payIn.getRequest(request.id))?.status).toBe("pending");

    breakState = false;
    rmSync(stateTmp, { recursive: true });
    const done = await deliver(node, d.body, sig);
    expect(done.json).toMatchObject({ applied: true, status: "completed" });
    expect(await recordCount(node, key, PAYMENT_COMPLETED)).toBe(1);
    expect(await poolMinor(node, key)).toBe(50_000);
  });

  it("a failed record write after the status is saved reports status_written, and a redelivery writes the record", async () => {
    let failing = true;
    const node = await start(freshFolder(), {
      faults: { failRecordWrite: (type) => failing && type === PAYMENT_FAILED },
    });
    const { joiner, key } = await community(node);
    const { request } = await pledge(node, joiner, key);
    const d = await simulated(node).payIn.settle(request.id, "failed");
    const sig = d.headers["x-simulated-signature"];

    const stopped = await deliver(node, d.body, sig);
    expect(stopped.status).toBe(503);
    expect(stopped.json).toMatchObject({ problem: "status_written" });
    expect((await simulated(node).payIn.getRequest(request.id))?.status).toBe("failed");
    expect(await recordCount(node, key, PAYMENT_FAILED)).toBe(0);

    failing = false;
    const repaired = await deliver(node, d.body, sig);
    expect(repaired.status).toBe(200);
    expect(await recordCount(node, key, PAYMENT_FAILED)).toBe(1);
  });

  it("a failure with no pledge is applied at the bank and flagged; nothing is recorded", async () => {
    const node = await start();
    const { creator, key } = await community(node);
    const created = await simulated(node).payIn.createRequest({
      amount: money("ZAR", 50_000),
      externalReference: randomEventId(),
      payerReference: "STOKVEL",
      beneficiaryReference: "OCN POOL",
      expireAt: Date.now() + 86_400_000,
    });
    if (!created.ok) throw new Error(created.error.message);
    const d = await simulated(node).payIn.settle(created.value.id, "failed");
    const res = await deliver(node, d.body, d.headers["x-simulated-signature"]);
    expect(res.json).toMatchObject({ applied: true, status: "failed", flagged: "no_pledge" });
    expect(await recordCount(node, key, PAYMENT_FAILED)).toBe(0);
    const kinds = ((await checkingOf(node, creator, key)).json.flags as { kind: string }[]).map(
      (f) => f.kind,
    );
    expect(kinds).toContain("no_pledge");
  });

  it("an out-of-order webhook: a cancellation then a completion, the completion is flagged and not applied", async () => {
    const node = await start();
    const { creator, joiner, key } = await community(node);
    const { request } = await pledge(node, joiner, key);
    const cancelled = await simulated(node).payIn.settle(request.id, "cancelled");
    const first = await deliver(node, cancelled.body, cancelled.headers["x-simulated-signature"]);
    expect(first.json).toMatchObject({ applied: true, status: "cancelled" });

    const paid = await verified(node, request, "completed");
    expect(paid.json).toMatchObject({
      applied: false,
      status: "cancelled",
      flagged: "completed_after_ended",
    });
    expect(await poolMinor(node, key)).toBe(0);
    expect(await recordCount(node, key, PAYMENT_COMPLETED)).toBe(0);
    expect(creator.did).toBeDefined();
  });

  it("a completion with no pledge is applied at the bank and flagged; nothing is posted to the books", async () => {
    const node = await start();
    const { creator, key } = await community(node);
    const created = await simulated(node).payIn.createRequest({
      amount: money("ZAR", 50_000),
      externalReference: randomEventId(),
      payerReference: "STOKVEL",
      beneficiaryReference: "OCN POOL",
      expireAt: Date.now() + 86_400_000,
    });
    if (!created.ok) throw new Error(created.error.message);
    const d = await simulated(node).payIn.settle(created.value.id, "completed");
    const res = await deliver(node, d.body, d.headers["x-simulated-signature"]);
    expect(res.json).toMatchObject({ applied: true, status: "completed", flagged: "no_pledge" });
    expect(await poolMinor(node, key)).toBe(0);
    const kinds = ((await checkingOf(node, creator, key)).json.flags as { kind: string }[]).map(
      (f) => f.kind,
    );
    expect(kinds).toContain("no_pledge");
  });
});

describe("the pool says simulated, and the treasurer's list (review items 1, 7, 9, 10)", () => {
  it("answers the pool figures with simulated true and the plain sentence", async () => {
    const node = await start();
    const { creator, key } = await community(node);
    const pool = await call(node, creator, "GET", `/communities/${key}/pool`);
    expect(pool.status).toBe(200);
    expect(pool.json).toMatchObject({ simulated: true, simulatedNote: SIMULATED_POOL_NOTE });
    expect(SIMULATED_POOL_NOTE).toBe(
      "These figures include test payments (simulated). No real money has moved.",
    );
  });

  it("moves a corrupt needs-checking file aside, logs it plainly, and starts with an empty list", async () => {
    const folder = freshFolder();
    writeFileSync(join(folder, "payment-checking.json"), "{not json");
    const sink = captureSink();
    running = await startNode({ env: env(folder), sink });
    expect(existsSync(join(folder, "payment-checking.json.bad"))).toBe(true);
    expect(sink.text()).toContain("moved aside");
    expect(sink.text()).toContain("(simulated)");
    const { creator, key } = await community(running);
    const list = await checkingOf(running, creator, key);
    expect(list.status).toBe(200);
    expect(list.json.flags).toEqual([]);
  });

  it("answers an unknown community and a stranger the same way, and every refusal says simulated", async () => {
    const node = await start();
    const { creator, key } = await community(node);
    const stranger = await phone();
    const unknown = await checkingOf(node, creator, randomKey());
    const outsider = await checkingOf(node, stranger, key);
    expect(unknown.status).toBe(403);
    expect(outsider.status).toBe(403);
    expect(unknown.json.problem).toBe(outsider.json.problem);
    expect(unknown.json.reason).toBe(outsider.json.reason);
    expect(String(unknown.json.reason)).toContain("(simulated)");
    const unsigned = await call(node, undefined, "GET", `/communities/${key}/needs-checking`);
    expect(String(unsigned.json.reason)).toContain("(simulated)");
  });
});
