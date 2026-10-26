// One member's pledge, from the pledge to the confirmed books, through the real Node wiring (stories 4.3 and 4.5):
// a community, a member's `pledge.created` in the record's shape, Pay (`POST /payments/requests`), approval on the
// simulated bank page (which goes through the same confirmation as a verified webhook), then the books, the record
// and the pool all hold the completion for that member. SIMULATED: the bank is the simulated Stitch (story 4.4).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  encodeProof,
  issueInvitation,
  newCommunityKey,
  signRequest,
  type RequestParts,
} from "@shopong/community";
import { createEvent, eventIdOf, webCryptoSha512, type EventEnvelope } from "@shopong/events";
import { memberLiabilityOf, poolAccountOf } from "@shopong/ledger-sqlite";
import { afterAll, afterEach, describe, expect, it } from "vite-plus/test";
import { memberIdOf } from "./pool-read.ts";
import { startNode, type RunningNode } from "./node.ts";
import { captureSink, FAKE_SECRETS } from "./testing/capture.ts";
import { phone, randomHex, type Phone } from "./testing/community.ts";

const folders: string[] = [];
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

let running: RunningNode | undefined;
afterEach(async () => {
  await running?.close().catch(() => undefined);
  running = undefined;
});

/** A valid 32-byte community secret for the Node (the shared fake is not hex, so the payer reference would be refused). */
const COMMUNITY_SECRET = "1c7e9a3f5b2d8e6a0c4f7b1e9d3a5c8f2b6e0d4a7c9f1e3b5d8a2c6f0e4b7d91";
const POOL_PAID = 15_000;

async function start(): Promise<RunningNode> {
  const folder = mkdtempSync(join(tmpdir(), "ocn-pledge-confirm-"));
  folders.push(folder);
  running = await startNode({
    env: {
      OCN_NODE_PORT: "0",
      OCN_NODE_DATA_DIR: folder,
      RECORD_MASTER_KEY: FAKE_SECRETS.RECORD_MASTER_KEY,
      OCN_NODE_PAYMENTS_ENABLED: "true",
      OCN_NODE_LEDGER_ENABLED: "true",
      SIMULATED_WEBHOOK_SECRET: FAKE_SECRETS.SIMULATED_WEBHOOK_SECRET,
      OCN_NODE_ALLOW_SIMULATED_PAYMENTS: "true",
      COMMUNITY_SECRET,
    },
    sink: captureSink(),
  });
  return running;
}

type Reply = { status: number; json: Record<string, unknown> };

async function call(
  node: RunningNode,
  signer: Phone,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<Reply> {
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

const randomKey = (): string => newCommunityKey((n) => crypto.getRandomValues(new Uint8Array(n)));

async function eventOf(
  key: string,
  who: Phone,
  type: string,
  payload: Record<string, unknown>,
  proof: string[] = [],
): Promise<EventEnvelope> {
  return createEvent({
    type,
    space: key,
    actor: who.did,
    proof,
    claimedAt: Date.now(),
    nonce: randomHex(16),
    payload,
  } as never) as EventEnvelope;
}

/** Posts an event to the community, retrying while the member's replica is still joining. */
async function post(node: RunningNode, who: Phone, key: string, event: unknown): Promise<Reply> {
  let last: Reply = { status: 0, json: {} };
  for (let i = 0; i < 100; i++) {
    last = await call(node, who, "POST", `/spaces/${key}/events`, event);
    if (last.status !== 403 || last.json.problem !== "not_writable") return last;
    await new Promise((r) => setTimeout(r, 50));
  }
  return last;
}

/** A community with its creator, and one member admitted and joined (the member pledges). */
async function communityWithMember(node: RunningNode) {
  const creator = await phone();
  const key = randomKey();
  expect((await call(node, creator, "POST", "/communities", { key })).status).toBe(200);
  const founder = await eventOf(key, creator, "member.joined", { invitation: "founder" });
  expect((await post(node, creator, key, founder)).status).toBe(200);

  const member = await phone();
  const issued = await issueInvitation({
    auth: creator.auth,
    creator: creator.did,
    spaceKey: key,
    invitee: member.did,
    now: Date.now(),
  });
  if (!issued.ok) throw new Error(issued.error.message);
  const invited = await eventOf(key, creator, "member.invited", {
    invitation: issued.value.id,
    invitee: member.did,
    expiresAt: issued.value.expiresAt,
  });
  expect((await post(node, creator, key, invited)).status).toBe(200);
  expect(
    (
      await call(node, member, "POST", `/communities/${key}/members`, {
        invitation: issued.value.link,
      })
    ).status,
  ).toBe(200);
  const joined = await eventOf(key, member, "member.joined", { invitation: issued.value.id }, [
    encodeProof(issued.value.token),
  ]);
  expect((await post(node, member, key, joined)).status).toBe(200);
  return { creator, member, key };
}

describe("one member's pledge through to the confirmed books (stories 4.3 and 4.5)", () => {
  it("pledge, Pay, approve the bank page: the books, the record and the pool hold the completion for that member", async () => {
    const node = await start();
    const { creator, member, key } = await communityWithMember(node);

    // The member pledges R150.00 in the record's shape (the amount in whole cents, the member is the actor).
    const pledge = await eventOf(key, member, "pledge.created", {
      order: "March groceries",
      member: member.did,
      amount: { currency: "ZAR", minor: POOL_PAID },
    });
    const pledged = await post(node, member, key, pledge);
    expect(pledged.status).toBe(200);
    const pledgeId = String(pledged.json.id);
    expect(pledgeId).toBe(await eventIdOf(pledge, webCryptoSha512));

    // Pay: the Node makes the request for the pledge and writes its own payment.requested into the record.
    const paid = await call(node, member, "POST", "/payments/requests", {
      community: key,
      pledge: pledgeId,
    });
    expect(paid.status).toBe(200);
    expect(paid.json.recorded).toBe(true);
    const bankPath = String(paid.json.bankPath);
    expect(bankPath).toMatch(/^\/simulated-bank\/pir_/u);

    // Approve on the simulated bank page: the page's own button, which goes through the verified confirmation.
    const approved = await fetch(`${node.url}${bankPath}/approve`, {
      method: "POST",
      redirect: "manual",
    });
    expect(approved.status).toBe(303);

    // The books: the pool holds the payment and the member's liability is credited (the member's opaque id).
    const ledger = node.ledger!;
    expect((await ledger.balance(poolAccountOf(key), "ZAR")).balance.minor).toBe(POOL_PAID);
    const memberId = memberIdOf(
      Buffer.from(FAKE_SECRETS.RECORD_MASTER_KEY, "hex"),
      key,
      member.did,
    );
    expect((await ledger.balance(memberLiabilityOf(key, memberId), "ZAR")).balance.minor).toBe(
      POOL_PAID,
    );

    // The record: exactly one completion, for this pledge, for this member, signed by the Node's identity.
    const completed = (await node.hub!.journalOf(key)).filter(
      (e) => e.event.type === "payment.completed",
    );
    expect(completed).toHaveLength(1);
    expect(completed[0]!.event.payload).toMatchObject({
      externalReference: pledgeId,
      memberId,
      amountMinor: POOL_PAID,
      status: "completed",
      by: node.nodeIdentity,
    });
    expect(creator.did).toBeDefined();

    // The pool, as the member reads it, shows the payment.
    const pool = await call(node, member, "GET", `/communities/${key}/pool`);
    expect(pool.status).toBe(200);
    expect(pool.json.total).toMatchObject({ minor: String(POOL_PAID) });
    expect(pool.json.you).toMatchObject({ minor: String(POOL_PAID) });
  });
});
