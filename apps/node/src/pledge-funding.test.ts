// The demonstration's pledge and pay, from five members to a funded pool, through the real Node wiring (stories 4.3,
// 4.5, 4.6 and 8.3): a treasurer's chosen supplier sets the target, five members pledge their share, four pay (one
// webhook is delivered twice), one has not paid. Then the fifth pays and the pool is funded. The figures match
// `packages/scenario-stokvel`'s `pool-funded` step: target R4,180.00, pledges of R840.00, R4,200.00 collected.
// SIMULATED: the bank is the simulated Stitch (story 4.4). Every surface these tests read says so.
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

/** A valid 32-byte community secret for the Node (see pledge-to-confirmation.test.ts). */
const COMMUNITY_SECRET = "1c7e9a3f5b2d8e6a0c4f7b1e9d3a5c8f2b6e0d4a7c9f1e3b5d8a2c6f0e4b7d91";
const ORDER = "March groceries";
/** The chosen supplier's total for the order (scenario-stokvel's supplier s1): R4,180.00. */
const TARGET = 418_000;
/** Five equal shares of the target, rounded up to R10.00 as the scenario pledges them (R840.00 each). */
const PLEDGE = 84_000;
const MEMBERS = 5;

async function start(): Promise<RunningNode> {
  const folder = mkdtempSync(join(tmpdir(), "ocn-pledge-funding-"));
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

/** The creator invites a person, who joins: returns the new member. */
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

/** The treasurer, a community with five members, one order approved and a supplier chosen at the target. */
async function fiveMembersAndAChoice(node: RunningNode) {
  const treasurer = await phone();
  const key = randomKey();
  expect((await call(node, treasurer, "POST", "/communities", { key })).status).toBe(200);
  const founder = await eventOf(key, treasurer, "member.joined", { invitation: "founder" });
  expect((await post(node, treasurer, key, founder)).status).toBe(200);
  const members: Phone[] = [treasurer];
  for (let i = 1; i < MEMBERS; i++) members.push(await admit(node, treasurer, key));

  const proposal = await post(
    node,
    treasurer,
    key,
    await eventOf(key, treasurer, "order.proposed", {
      name: ORDER,
      items: [{ item: "Sugar", quantity: 1 }],
      budgetPerMemberMinor: PLEDGE,
      deadline: Date.now() + 7 * 24 * 60 * 60 * 1000,
    }),
  );
  expect(proposal.status).toBe(200);
  const id = String(proposal.json.id);
  expect(
    (
      await post(
        node,
        treasurer,
        key,
        await eventOf(key, treasurer, "order.approved", { order: id }),
      )
    ).status,
  ).toBe(200);
  const quote = await post(
    node,
    treasurer,
    key,
    await eventOf(key, treasurer, "quote.added", {
      supplier: "s1",
      order: ORDER,
      lines: [{ item: "Sugar", unit: "bag", packSize: 1, pricePerPackCents: TARGET }],
      delivery: { feeCents: 0, days: 0 },
    }),
  );
  expect(quote.status).toBe(200);
  const choice = await post(
    node,
    treasurer,
    key,
    await eventOf(key, treasurer, "quote.selected", {
      order: ORDER,
      supplier: "s1",
      totalMinor: TARGET,
    }),
  );
  expect(choice.status).toBe(200);
  return { treasurer, key, members };
}

/** The member's pledge of their share, as the record holds it: the pledge's event id. */
async function pledge(node: RunningNode, member: Phone, key: string): Promise<string> {
  const event = await eventOf(key, member, "pledge.created", {
    order: ORDER,
    member: member.did,
    amount: { currency: "ZAR", minor: PLEDGE },
  });
  const reply = await post(node, member, key, event);
  expect(reply.status).toBe(200);
  return String(reply.json.id);
}

/** The member's status for their pledge, as the Node's payments answer it. */
async function statusOf(node: RunningNode, member: Phone, key: string, pledgeId: string) {
  const reply = await call(
    node,
    member,
    "GET",
    `/payments/status?community=${key}&pledge=${pledgeId}`,
  );
  expect(reply.status).toBe(200);
  return reply.json;
}

/** The pool as the member reads it (the Node's own words and figures). */
const poolOf = async (node: RunningNode, who: Phone, key: string) => {
  const reply = await call(node, who, "GET", `/communities/${key}/pool`);
  expect(reply.status).toBe(200);
  return reply.json as {
    total: { minor: string };
    target: { minor: string } | null;
    funding: { percent: number; text: string } | null;
    members: { you: boolean; status: { kind: string; label: string } }[];
    you: { status: { kind: string; label: string }; minor: string };
  };
};

/** Asks the Node for the member's bank payment of their pledge, returning the request id from its bank address. */
async function requestPayment(node: RunningNode, member: Phone, key: string, pledgeId: string) {
  const paid = await call(node, member, "POST", "/payments/requests", {
    community: key,
    pledge: pledgeId,
  });
  expect(paid.status).toBe(200);
  expect(paid.json.recorded).toBe(true);
  const bankPath = String(paid.json.bankPath);
  return { bankPath, id: bankPath.split("/").pop() ?? "" };
}

/** The simulated bank page's own approval, which goes through the verified confirmation. */
async function approveOnBankPage(node: RunningNode, bankPath: string) {
  const approved = await fetch(`${node.url}${bankPath}/approve`, {
    method: "POST",
    redirect: "manual",
  });
  expect(approved.status).toBe(303);
}

/** A verified delivery of the simulated processor's completion, sent to the Node as the bank would send it. */
async function deliverCompletion(node: RunningNode, requestId: string) {
  const delivery = await node.payments!.payIn.settle(requestId, "completed");
  const send = () =>
    fetch(`${node.url}/webhooks/payments`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-simulated-signature": delivery.headers["x-simulated-signature"],
      },
      body: delivery.body,
    });
  return { first: await send(), replay: await send() };
}

describe("five members pledge, four pay, one has not paid, then the pool is funded (stories 4.3, 4.5, 4.6, 8.3)", () => {
  it("walks the pledges from requested to paid, shows the unpaid member as not paid yet, and funds the pool", async () => {
    const node = await start();
    const { treasurer, key, members } = await fiveMembersAndAChoice(node);
    const [, paidOne, paidTwo, replayed, unpaid] = members as [Phone, Phone, Phone, Phone, Phone];

    // Every member pledges their share. Nothing is paid yet, so every member is Waiting on the pool and Not paid yet.
    const pledges = new Map<Phone, string>();
    for (const member of members) pledges.set(member, await pledge(node, member, key));

    const before = await poolOf(node, treasurer, key);
    expect(before.target).toEqual({ minor: String(TARGET), text: "The target is R4180.00." });
    expect(before.total.minor).toBe("0");
    expect(before.funding).toEqual({ percent: 0, text: "R0.00 of R4180.00 is in." });
    expect(before.members.map((m) => m.status.label)).toEqual(Array(MEMBERS).fill("Waiting"));
    expect((await statusOf(node, unpaid, key, pledges.get(unpaid)!)).status).toBe("none");

    // Requested: a member asks to pay, and the Node says the request is pending with its bank address.
    const first = await requestPayment(node, paidOne, key, pledges.get(paidOne)!);
    expect(await statusOf(node, paidOne, key, pledges.get(paidOne)!)).toMatchObject({
      status: "pending",
      bankPath: first.bankPath,
    });
    // Paid: the bank page approves it, and the Node's status says completed.
    await approveOnBankPage(node, first.bankPath);
    expect(await statusOf(node, paidOne, key, pledges.get(paidOne)!)).toMatchObject({
      status: "completed",
    });

    // A second member pays the same way; the treasurer pays through the bank page too.
    const second = await requestPayment(node, paidTwo, key, pledges.get(paidTwo)!);
    await approveOnBankPage(node, second.bankPath);
    const own = await requestPayment(node, treasurer, key, pledges.get(treasurer)!);
    await approveOnBankPage(node, own.bankPath);

    // The third member's completion is delivered twice: one payment, one confirmation, the pool changes once.
    const replayRequest = await requestPayment(node, replayed, key, pledges.get(replayed)!);
    const { first: delivered, replay } = await deliverCompletion(node, replayRequest.id);
    expect(delivered.status).toBe(200);
    expect(replay.status).toBe(200);
    expect((await delivered.json()) as Record<string, unknown>).toMatchObject({ applied: true });
    expect((await replay.json()) as Record<string, unknown>).toMatchObject({ applied: false });
    expect(await statusOf(node, replayed, key, pledges.get(replayed)!)).toMatchObject({
      status: "completed",
    });

    // Four members have paid: the pool holds four pledges, and the bar shows 80 percent of the target.
    const four = await poolOf(node, treasurer, key);
    expect(four.total.minor).toBe(String(4 * PLEDGE));
    expect(four.funding).toEqual({ percent: 80, text: "R3360.00 of R4180.00 is in." });
    expect(four.members.map((m) => m.status.label).sort()).toEqual([
      "Paid",
      "Paid",
      "Paid",
      "Paid",
      "Waiting",
    ]);
    // The unpaid member sees their own card's words and the pool's word for them, and no bank address.
    const unpaidPool = await poolOf(node, unpaid, key);
    expect(unpaidPool.you.status).toEqual({ kind: "waiting", label: "Waiting" });
    expect(unpaidPool.you.minor).toBe("0");
    const unpaidStatus = await statusOf(node, unpaid, key, pledges.get(unpaid)!);
    expect(unpaidStatus.status).toBe("none");
    expect(unpaidStatus.bankPath).toBeUndefined();
    expect(JSON.stringify(unpaidPool)).not.toContain("simulated-bank");

    // The fifth member pays after a retry, and the pool is funded: the scenario's pool-funded figures.
    const late = await requestPayment(node, unpaid, key, pledges.get(unpaid)!);
    await approveOnBankPage(node, late.bankPath);
    const funded = await poolOf(node, treasurer, key);
    expect(funded.total.minor).toBe(String(MEMBERS * PLEDGE));
    expect(funded.total.minor).toBe("420000");
    expect(funded.target).toEqual({ minor: String(TARGET), text: "The target is R4180.00." });
    expect(funded.funding).toEqual({ percent: 100, text: "R4200.00 of R4180.00 is in." });
    expect(funded.members.map((m) => m.status.label)).toEqual(Array(MEMBERS).fill("Paid"));
    expect(funded.you.status.label).toBe("Paid");

    // One confirmation per payment, so the replayed delivery added nothing to the record.
    const completed = (await node.hub!.journalOf(key)).filter(
      (e) => e.event.type === "payment.completed",
    );
    expect(completed).toHaveLength(MEMBERS);
  }, 30_000);
});
