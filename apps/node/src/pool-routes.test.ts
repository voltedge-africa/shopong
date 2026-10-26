// The Node's pool read and its record mirror (story 4.6), over real HTTP and a real Autobase record in a temp data
// folder. The books are the in-memory ledger; the postings are mirrored to the record by `postAndMirror`.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryLedger } from "@shopong/adapters-memory";
import {
  configureChart,
  configureMemberAccount,
  memberLiability,
  POOL_BANK,
} from "@shopong/ledger-sqlite";
import {
  encodeProof,
  issueInvitation,
  newCommunityKey,
  signRequest,
  type RequestParts,
} from "@shopong/community";
import { createEvent, webCryptoSha512 } from "@shopong/events";
import { money, type Ledger, type LedgerEntry } from "@shopong/ports";
import { afterAll, afterEach, describe, expect, it } from "vite-plus/test";
import { postAndMirror } from "./ledger-mirror.ts";
import { memberIdOf } from "./pool-read.ts";
import { startNode, type RunningNode } from "./node.ts";
import { captureSink, FAKE_SECRETS } from "./testing/capture.ts";
import { phone, randomHex, type Phone } from "./testing/community.ts";

const folders: string[] = [];
const freshFolder = (): string => {
  const folder = mkdtempSync(join(tmpdir(), "ocn-node-pool-"));
  folders.push(folder);
  return folder;
};
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

let running: RunningNode | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

const MASTER_KEY = Buffer.from(FAKE_SECRETS.RECORD_MASTER_KEY, "hex");
const clock = { now: () => Date.now() };

/** A fresh in-memory ledger, the chart configured. */
async function books(): Promise<MemoryLedger> {
  const ledger = new MemoryLedger({ clock });
  const configured = await configureChart(ledger);
  if (!configured.ok) throw new Error(configured.error.message);
  return ledger;
}

async function start(ledger?: Ledger): Promise<RunningNode> {
  running = await startNode({
    env: {
      OCN_NODE_PORT: "0",
      OCN_NODE_DATA_DIR: freshFolder(),
      RECORD_MASTER_KEY: FAKE_SECRETS.RECORD_MASTER_KEY,
    },
    sink: captureSink(),
    ...(ledger === undefined ? {} : { ledger }),
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
  type: "member.joined" | "member.invited" | "quote.selected" | "ledger.posted",
  payload: Record<string, unknown>,
  proof: string[] = [],
  at = Date.now(),
): Promise<unknown> {
  return createEvent({
    type,
    space: key,
    actor: who.did,
    proof,
    claimedAt: at,
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

/** A community with its creator (founder) and a second member admitted and joined. */
async function twoMembers(node: RunningNode) {
  const creator = await phone();
  const key = randomKey();
  expect((await call(node, creator, "POST", "/communities", { key })).status).toBe(200);
  const founder = await eventOf(key, creator, "member.joined", { invitation: "founder" });
  expect((await post(node, creator, key, founder)).status).toBe(200);

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
  return { creator, joiner, key };
}

/** The pool is the creator's: the books hold a pay-in for `who` of `rands` rand, mirrored to the record. */
async function payIn(
  node: RunningNode,
  ledger: Ledger,
  key: string,
  who: Phone,
  cents: number,
  options: { mirror?: boolean; key?: string } = {},
) {
  const memberId = memberIdOf(MASTER_KEY, who.did);
  await configureMemberAccount(ledger, memberId);
  const entries: LedgerEntry[] = [
    { account: POOL_BANK, direction: "debit", amount: money("ZAR", cents) },
    { account: memberLiability(memberId), direction: "credit", amount: money("ZAR", cents) },
  ];
  const idempotencyKey = options.key ?? randomHex(64);
  if (options.mirror === false) {
    const posted = await ledger.post({ idempotencyKey, description: "Pay-in", entries });
    if (!posted.ok) throw new Error(posted.error.message);
    return idempotencyKey;
  }
  const done = await postAndMirror(
    { ledger, hub: node.hub!, nodeIdentity: node.nodeIdentity! },
    { communityKey: key, idempotencyKey, description: "Pay-in", entries },
  );
  if (!done.ok) throw new Error(done.error.message);
  return idempotencyKey;
}

const pool = (node: RunningNode, who: Phone, key: string) =>
  call(node, who, "GET", `/communities/${key}/pool`);

describe("GET /communities/:key/pool", () => {
  it("refuses an unsigned request", async () => {
    const node = await start(await books());
    const { key } = await twoMembers(node);
    const reply = await call(node, undefined, "GET", `/communities/${key}/pool`);
    expect(reply.status).toBe(401);
    expect(reply.json.problem).toBe("unsigned");
  });

  it("refuses a community the Node does not hold, and a stranger, in plain words", async () => {
    const node = await start(await books());
    const { creator, key } = await twoMembers(node);
    const missing = await pool(node, creator, randomKey());
    expect(missing.status).toBe(404);
    const stranger = await phone();
    const refused = await pool(node, stranger, key);
    expect(refused.status).toBe(403);
    expect(refused.json.problem).toBe("not_member");
    expect(refused.json.reason).toBe("You are not a member of this community.");
  });

  it("says the books can't be read when no ledger is configured (503)", async () => {
    const node = await start();
    const { creator, key } = await twoMembers(node);
    const reply = await pool(node, creator, key);
    expect(reply.status).toBe(503);
    expect(reply.json.problem).toBe("books_unavailable");
    expect(reply.json.reason).toBe("The books can't be read right now.");
  });

  it("says the books can't be read when the ledger read throws, and shows no figures", async () => {
    const ledger = await books();
    const broken: Ledger = Object.assign(Object.create(ledger), {
      balance: async () => {
        throw new Error("disk gone");
      },
    });
    const node = await start(broken);
    const { creator, key } = await twoMembers(node);
    const reply = await pool(node, creator, key);
    expect(reply.status).toBe(503);
    expect(reply.json.reason).toBe("The books can't be read right now.");
    expect(reply.json.total).toBeUndefined();
  });

  it("shows the books' total with no flag when the books and the record agree", async () => {
    const ledger = await books();
    const node = await start(ledger);
    const { creator, key } = await twoMembers(node);
    await payIn(node, ledger, key, creator, 50_000);
    const reply = await pool(node, creator, key);
    expect(reply.status).toBe(200);
    expect(reply.json.total).toEqual({ minor: "50000", text: "The pool holds R500.00." });
    expect(reply.json.flags).toEqual([]);
    expect(reply.json.you).toMatchObject({
      minor: "50000",
      text: "You have paid R500.00",
      share: null,
      status: { kind: "no_target", label: "No target yet" },
    });
  });

  it("flags a mismatch with both amounts and still shows the ledger total", async () => {
    const ledger = await books();
    const node = await start(ledger);
    const { creator, key } = await twoMembers(node);
    await payIn(node, ledger, key, creator, 50_000, { mirror: false });
    const reply = await pool(node, creator, key);
    expect(reply.status).toBe(200);
    expect(reply.json.total).toEqual({ minor: "50000", text: "The pool holds R500.00." });
    expect(reply.json.flags).toContainEqual({
      kind: "mismatch",
      text: "The books show R500.00 but the shared record shows R0.00. The difference is R500.00.",
    });
  });

  it("clears the flag once the same posting is mirrored again (a retry repairs the record)", async () => {
    const ledger = await books();
    const node = await start(ledger);
    const { creator, key } = await twoMembers(node);
    const idempotencyKey = await payIn(node, ledger, key, creator, 50_000, { mirror: false });
    const memberId = memberIdOf(MASTER_KEY, creator.did);
    const again = await postAndMirror(
      { ledger, hub: node.hub!, nodeIdentity: node.nodeIdentity! },
      {
        communityKey: key,
        idempotencyKey,
        description: "Pay-in",
        entries: [
          { account: POOL_BANK, direction: "debit", amount: money("ZAR", 50_000) },
          { account: memberLiability(memberId), direction: "credit", amount: money("ZAR", 50_000) },
        ],
      },
    );
    expect(again.ok).toBe(true);
    const reply = await pool(node, creator, key);
    expect(reply.json.flags).toEqual([]);
  });

  it("mirrors each posting once: a retry of the same posting adds no second record event", async () => {
    const ledger = await books();
    const node = await start(ledger);
    const { creator, key } = await twoMembers(node);
    const idempotencyKey = await payIn(node, ledger, key, creator, 10_000);
    const memberId = memberIdOf(MASTER_KEY, creator.did);
    const entries: LedgerEntry[] = [
      { account: POOL_BANK, direction: "debit", amount: money("ZAR", 10_000) },
      { account: memberLiability(memberId), direction: "credit", amount: money("ZAR", 10_000) },
    ];
    for (let i = 0; i < 2; i++) {
      const done = await postAndMirror(
        { ledger, hub: node.hub!, nodeIdentity: node.nodeIdentity! },
        { communityKey: key, idempotencyKey, description: "Pay-in", entries },
      );
      expect(done.ok).toBe(true);
    }
    const mirrored = (await node.hub!.journalOf(key)).filter(
      (e) => e.event.type === "ledger.posted",
    );
    expect(mirrored).toHaveLength(1);
    const reply = await pool(node, creator, key);
    expect(reply.json.flags).toEqual([]);
    expect(reply.json.you).toMatchObject({ minor: "10000" });
  });

  it("gives each member their own amount and everyone's status, never another member's amount", async () => {
    const ledger = await books();
    const node = await start(ledger);
    const { creator, joiner, key } = await twoMembers(node);
    await payIn(node, ledger, key, creator, 12_345);
    expect(
      (
        await post(
          node,
          creator,
          key,
          await eventOf(key, creator, "quote.selected", {
            order: "o1",
            supplier: "s1",
            totalMinor: 40_000,
          }),
        )
      ).status,
    ).toBe(200);

    const asJoiner = await pool(node, joiner, key);
    expect(asJoiner.status).toBe(200);
    expect(asJoiner.json.you).toMatchObject({
      minor: "0",
      text: "You have paid R0.00",
      share: "20000",
      status: { kind: "waiting", label: "Waiting" },
    });
    expect(asJoiner.json.target).toEqual({ minor: "40000", text: "The target is R400.00." });
    // Everyone's status, no amounts: the creator's R123.45 is not in anything the joiner is shown but the total.
    const others = JSON.stringify({ members: asJoiner.json.members, flags: asJoiner.json.flags });
    expect(others).not.toContain("123.45");
    expect(others).not.toContain("12345");
    expect(JSON.stringify(asJoiner.json.members)).not.toMatch(/R\d/);
    const labels = (asJoiner.json.members as { status: { label: string } }[])
      .map((m) => m.status.label)
      .sort();
    expect(labels).toEqual(["Part paid", "Waiting"]);
    const mine = (asJoiner.json.members as { you: boolean; status: { label: string } }[]).filter(
      (m) => m.you,
    );
    expect(mine).toEqual([{ you: true, status: { kind: "waiting", label: "Waiting" } }]);
  });

  it("shows Paid for each member once every share is paid", async () => {
    const ledger = await books();
    const node = await start(ledger);
    const { creator, joiner, key } = await twoMembers(node);
    await post(
      node,
      creator,
      key,
      await eventOf(key, creator, "quote.selected", {
        order: "o1",
        supplier: "s1",
        totalMinor: 20_000,
      }),
    );
    await payIn(node, ledger, key, creator, 10_000);
    await payIn(node, ledger, key, joiner, 10_000);
    const reply = await pool(node, creator, key);
    const statuses = (reply.json.members as { status: { label: string } }[]).map(
      (m) => m.status.label,
    );
    expect(statuses).toEqual(["Paid", "Paid"]);
    expect(reply.json.you).toMatchObject({ share: "10000", status: { kind: "paid" } });
  });

  it("flags a member account with no matching member in the record", async () => {
    const ledger = await books();
    const node = await start(ledger);
    const { creator, key } = await twoMembers(node);
    const stranger = "e".repeat(128);
    await configureMemberAccount(ledger, stranger);
    await ledger.post({
      idempotencyKey: randomHex(64),
      description: "Old pay-in",
      entries: [
        { account: POOL_BANK, direction: "debit", amount: money("ZAR", 700) },
        { account: memberLiability(stranger), direction: "credit", amount: money("ZAR", 700) },
      ],
    });
    const reply = await pool(node, creator, key);
    expect(reply.json.flags).toContainEqual({
      kind: "unmatched_member",
      text: "A member account has no matching member in the record.",
    });
  });

  it("does not let a member write a money posting to the record (only the Node does)", async () => {
    const node = await start(await books());
    const { creator, key } = await twoMembers(node);
    const forged = await eventOf(key, creator, "ledger.posted", {
      key: "f".repeat(128),
      description: "Forged",
      entries: [],
    });
    const reply = await post(node, creator, key, forged);
    expect(reply.status).toBe(403);
    expect(reply.json.problem).toBe("node_only");
  });

  it("is not refused by the record's own personal-data check (the view holds no rejection for a mirror)", async () => {
    const ledger = await books();
    const node = await start(ledger);
    const { creator, key } = await twoMembers(node);
    await payIn(node, ledger, key, creator, 50_000);
    const view = await node.hub!.indexedView(key);
    expect(view).toBeDefined();
    expect(await view!.list("rejected/")).toEqual([]);
  });

  it("refuses a description that holds a phone number, before anything is posted", async () => {
    const ledger = await books();
    const node = await start(ledger);
    const { creator, key } = await twoMembers(node);
    const memberId = memberIdOf(MASTER_KEY, creator.did);
    const done = await postAndMirror(
      { ledger, hub: node.hub!, nodeIdentity: node.nodeIdentity! },
      {
        communityKey: key,
        idempotencyKey: randomHex(64),
        description: "Pay-in from 0821234567",
        entries: [
          { account: POOL_BANK, direction: "debit", amount: money("ZAR", 100) },
          { account: memberLiability(memberId), direction: "credit", amount: money("ZAR", 100) },
        ],
      },
    );
    expect(done.ok).toBe(false);
    expect((await ledger.trialBalance()).lines).toEqual([]);
    expect(
      (await node.hub!.journalOf(key)).filter((e) => e.event.type === "ledger.posted"),
    ).toEqual([]);
  });

  it("writes each mirror as the writer's own event (the phone's pull check needs writer = actor)", async () => {
    const ledger = await books();
    const node = await start(ledger);
    const { creator, key } = await twoMembers(node);
    await payIn(node, ledger, key, creator, 50_000);
    const mirrored = (await node.hub!.journalOf(key)).filter(
      (e) => e.event.type === "ledger.posted",
    );
    expect(mirrored).toHaveLength(1);
    expect(mirrored[0]!.writer).toBe(mirrored[0]!.event.actor);
    expect((mirrored[0]!.event.payload as { by?: string }).by).toBe(node.nodeIdentity);
  });

  it("rebuilds the same books from the record alone", async () => {
    const ledger = await books();
    const node = await start(ledger);
    const { creator, joiner, key } = await twoMembers(node);
    await payIn(node, ledger, key, creator, 30_000);
    await payIn(node, ledger, key, joiner, 5_500);

    const rebuilt = await books();
    for (const entry of await node.hub!.journalOf(key)) {
      if (entry.event.type !== "ledger.posted") continue;
      const payload = entry.event.payload as {
        key: string;
        description: string;
        entries: {
          account: string;
          member?: string;
          direction: "debit" | "credit";
          currency: string;
          minor: number;
        }[];
      };
      const posted = await rebuilt.post({
        idempotencyKey: payload.key,
        description: payload.description,
        entries: payload.entries.map((e) => ({
          account: e.account === "liabilities:member" ? memberLiability(e.member!) : e.account,
          direction: e.direction,
          amount: money(e.currency, e.minor),
        })),
      });
      expect(posted.ok).toBe(true);
    }
    expect((await rebuilt.balance(POOL_BANK, "ZAR")).balance.minor).toBe(35_500);
    expect(
      (await rebuilt.balance(memberLiability(memberIdOf(MASTER_KEY, joiner.did)), "ZAR")).balance
        .minor,
    ).toBe(5_500);
    expect(await rebuilt.trialBalance()).toEqual(await ledger.trialBalance());
  });
});
