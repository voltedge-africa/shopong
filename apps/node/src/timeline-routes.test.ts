// The transaction timeline route (story 10.2), over real HTTP and a real Autobase record. The pledge, Pay and bank-page
// steps are those of `pledge-to-confirmation.test.ts` (stories 4.3 and 4.5), and the bank is the simulated Stitch (4.4).
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
import { createEvent, webCryptoSha512, type EventEnvelope } from "@shopong/events";
import { afterAll, afterEach, describe, expect, it } from "vite-plus/test";
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

const PAID = POOL_PAID;

async function timelineOf(node: RunningNode, signer: Phone, key: string, pledgeId: string) {
  return call(node, signer, "GET", `/communities/${key}/transactions/${pledgeId}/timeline`);
}

async function pledgeAndPay(node: RunningNode, member: Phone, key: string) {
  const pledge = await eventOf(key, member, "pledge.created", {
    order: "March groceries",
    member: member.did,
    amount: { currency: "ZAR", minor: PAID },
  });
  const pledged = await post(node, member, key, pledge);
  expect(pledged.status).toBe(200);
  const pledgeId = String(pledged.json.id);
  const paid = await call(node, member, "POST", "/payments/requests", {
    community: key,
    pledge: pledgeId,
  });
  expect(paid.status).toBe(200);
  return { pledgeId, bankPath: String(paid.json.bankPath) };
}

describe("the transaction timeline of one payment (story 10.2)", () => {
  it("a completed payment shows pledged, requested, paid and posted, in order, joined by event id, and the record and books agree", async () => {
    const node = await start();
    const { member, key } = await communityWithMember(node);
    const { pledgeId, bankPath } = await pledgeAndPay(node, member, key);

    const approved = await fetch(`${node.url}${bankPath}/approve`, {
      method: "POST",
      redirect: "manual",
    });
    expect(approved.status).toBe(303);

    const reply = await timelineOf(node, member, key, pledgeId);
    expect(reply.status).toBe(200);
    const timeline = reply.json.timeline as {
      pledgeId: string;
      steps: { kind: string; label: string; words: string; eventId?: string; joinedTo?: string }[];
      agreement: { state: string; words: string };
    };
    expect(timeline.pledgeId).toBe(pledgeId);
    expect(timeline.steps.map((step) => step.kind)).toEqual([
      "pledged",
      "requested",
      "confirmed",
      "posted",
    ]);
    const [pledged, requested, confirmed, posted] = timeline.steps;
    expect(pledged?.eventId).toBe(pledgeId);
    expect(pledged?.words).toBe("You pledged R150.00.");
    expect(requested?.label).toBe("Payment requested");
    expect(confirmed?.label).toBe("Paid");
    // The completion is the Node's own event, and the posting is joined to it by that event id.
    const completed = (await node.hub!.journalOf(key)).find(
      (e) => e.event.type === "payment.completed",
    );
    expect(confirmed?.eventId).toBe(completed?.id);
    expect(posted?.joinedTo).toBe(completed?.id);
    expect(posted?.words).toBe("The pool books recorded R150.00 from you.");
    expect(timeline.agreement.state).toBe("agree");
    expect(timeline.agreement.words).toBe(
      "The record, the bank and the pool books agree on R150.00.",
    );
    expect(reply.json.booksNote).toBeUndefined();
    expect(reply.json.simulated).toBe(true);
  });

  it("a payment still waiting for the bank shows pledged and requested, and nothing to compare yet", async () => {
    const node = await start();
    const { member, key } = await communityWithMember(node);
    const { pledgeId } = await pledgeAndPay(node, member, key);

    const reply = await timelineOf(node, member, key, pledgeId);
    expect(reply.status).toBe(200);
    const timeline = reply.json.timeline as {
      steps: { kind: string; words: string }[];
      agreement: { state: string };
    };
    expect(timeline.steps.map((step) => step.kind)).toEqual(["pledged", "requested", "confirmed"]);
    expect(timeline.steps[2]?.words).toBe("Waiting for the bank to confirm the payment.");
    expect(timeline.agreement.state).toBe("waiting");
  });

  it("never sends a DID, a payer reference or a bank page address in the answer", async () => {
    const node = await start();
    const { creator, member, key } = await communityWithMember(node);
    const { pledgeId, bankPath } = await pledgeAndPay(node, member, key);
    const reply = await timelineOf(node, member, key, pledgeId);
    const text = JSON.stringify(reply.json);
    expect(text).not.toContain(member.did);
    expect(text).not.toContain(creator.did);
    expect(text).not.toContain(bankPath);
    expect(text).not.toContain("payerReference");
    expect(text).not.toContain("pir_");
  });

  it("refuses another member's payment, in plain words, with no figures", async () => {
    const node = await start();
    const { creator, member, key } = await communityWithMember(node);
    const { pledgeId } = await pledgeAndPay(node, member, key);
    const reply = await timelineOf(node, creator, key, pledgeId);
    expect(reply.status).toBe(403);
    expect(reply.json.problem).toBe("not_yours");
    expect(JSON.stringify(reply.json)).not.toContain("R150.00");
  });

  it("answers 404 for a payment that is not on the record", async () => {
    const node = await start();
    const { member, key } = await communityWithMember(node);
    const reply = await timelineOf(node, member, key, "f".repeat(128));
    expect(reply.status).toBe(404);
    expect(reply.json.problem).toBe("not_on_record");
  });

  it("refuses an unsigned request before reading anything", async () => {
    const node = await start();
    const { member, key } = await communityWithMember(node);
    const { pledgeId } = await pledgeAndPay(node, member, key);
    const res = await fetch(`${node.url}/communities/${key}/transactions/${pledgeId}/timeline`);
    expect(res.status).toBe(401);
    expect(JSON.stringify(await res.json())).not.toContain("R150.00");
  });
});
