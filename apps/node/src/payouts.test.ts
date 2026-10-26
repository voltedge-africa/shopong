// `POST /payouts` and `POST /suppliers/bank` (story 4.7). A supplier is paid only when enough people with authority have
// approved that exact payment, the pool covers it, and the Node's own table has not paid it already. The record is real:
// each test builds a community on the in-memory record with `apply`, and the Node's hub reads its view and writes to it.
// Rows marked [S-4.7] are the security and money rows of the plan. Every money line the Node writes says "simulated".
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import { createSimulatedStitch, type SimulatedStitch } from "@shopong/adapter-stitch-sim";
import { createMemoryRecordNetwork } from "@shopong/adapters-memory";
import {
  APPROVAL_TYPE,
  DAY_MS,
  PAYOUT_TYPE,
  approvalBytes,
  approvalsOf,
  paidPayoutsOf,
  poolView,
  checkInvitation,
  communityDefinition,
  coTreasurerJoinRecorded,
  createCommunity,
  isCurrentGrantIn,
  joinCommunity,
  logTimeOf,
  newCommunityKey,
  signRequest,
  type Community,
  type RequestParts,
} from "@shopong/community";
import { createEvent, webCryptoSha512, type EventEnvelope } from "@shopong/events";
import { configureChart, feesOf, openSqliteLedger, poolAccountOf } from "@shopong/ledger-sqlite";
import type { Did, Ledger, ViewReader } from "@shopong/ports";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { buildApp } from "./app.ts";
import { reconcile, type ReconcilerDeps } from "./reconciler.ts";
import { nodeHmacSha512 } from "./commitments.ts";
import { createLogger, type LogSink } from "./logger.ts";
import {
  bankCommitmentOf,
  createMemoryPayoutStore,
  openPayoutStore,
  type PayoutHub,
  type PayoutOptions,
  type PayoutStore,
} from "./payouts.ts";
import { phone, randomHex, T0, type Phone } from "./testing/community.ts";

const folders: string[] = [];
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

const DAYS = (n: number) => n * DAY_MS;
const NODE_IDENTITY = "did:key:z6MkfrQ7y7N9mWrVHgqZ6nqvpjhiWqwCfsZUYqL4pkoKJ2zL" as Did;
const ORDER = "Spaza restock";
const SUPPLIER = "Makro Soweto";
const ACCOUNT = "1234567890";
const BANK = {
  name: "Makro Soweto",
  bankId: "fnb",
  accountNumber: ACCOUNT,
  accountType: "current" as const,
};
const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));
/** The Node's commitment key in these tests (the production key is the record's master key). */
const COMMIT_KEY = new Uint8Array(64).map((_, i) => (i * 5 + 9) & 0xff);

/**
 * A community on one in-memory record: the creator, `coTreasurers` co-treasurers with a rand `limit` each, valid for `days`.
 * `approvals` is the founding setting (absent: the default of two).
 */
async function town(
  options: { approvals?: number; coTreasurers?: number; limit?: number; days?: number } = {},
) {
  const network = createMemoryRecordNetwork();
  const creator = await phone();
  const key = newCommunityKey(randomBytes);
  const made = await createCommunity(
    creator.deps,
    network.peer<EventEnvelope>(creator.did),
    "Ntombi Stokvel",
    T0,
    key,
    options.approvals,
  );
  if (!made.ok) throw new Error(made.error.message);
  const community: Community = made.value;
  const members: Community[] = [community];

  async function sync() {
    for (let round = 0; round < 2; round++) {
      for (const member of members)
        await network.replicate<EventEnvelope>(community.space, member.space);
    }
  }

  async function admit(p: Phone, now = T0): Promise<Community> {
    const invited = await community.invite(p.did, now);
    if (!invited.ok) throw new Error(invited.error.message);
    const space = await network
      .peer<EventEnvelope>(p.did)
      .open(community.space.key, communityDefinition(p.deps, creator.did, key));
    await network.replicate<EventEnvelope>(community.space, space);
    const checked = await checkInvitation({
      auth: p.auth,
      text: invited.value.code,
      me: p.did,
      now: now + DAY_MS,
      isUsed: async (id) => {
        await space.update();
        return (await space.view.get(`joined/${id}`)) !== undefined;
      },
      mayPassOn: (inviter, parentId) =>
        coTreasurerJoinRecorded(space.view, inviter, parentId, now + DAY_MS),
      isCurrentGrant: (holder, id) => isCurrentGrantIn(space.view, holder, id),
    });
    if (!checked.ok) throw new Error(checked.error.message);
    const joined = await joinCommunity(p.deps, space, checked.value, now + DAY_MS);
    if (!joined.ok) throw new Error(joined.error.message);
    members.push(joined.value);
    await sync();
    return joined.value;
  }

  /** Brings the record's log time up to `at`, a day at a time, with the creator's filler quotes (story 3.6's cap). */
  async function recordAt(at: number) {
    for (let step = 0; step < 400; step++) {
      await community.space.update();
      const logTime = (await logTimeOf(community.space.view)) ?? T0;
      if (logTime >= at) break;
      const added = await community.addQuote(
        {
          supplier: "Filler Wholesale",
          order: `Log ${step}`,
          lines: [{ item: "Sugar", unit: "bag", packSize: 1, pricePerPackCents: 12500 }],
          delivery: { feeCents: 0, days: 0 },
        },
        Math.min(at, logTime + DAY_MS),
      );
      if (!added.ok) throw new Error(added.error.message);
    }
    await sync();
  }

  const coTreasurers: Phone[] = [];
  for (let i = 0; i < (options.coTreasurers ?? 0); i++) {
    const co = await phone();
    coTreasurers.push(co);
    await admit(co);
    await recordAt(T0 + DAYS(2));
    const granted = await community.grantRole(
      co.did,
      "co-treasurer",
      {
        limit: { currency: "ZAR", minor: (options.limit ?? 1000) * 100 },
        days: options.days ?? 30,
      },
      T0 + DAYS(2),
    );
    if (!granted.ok) throw new Error(granted.error.message);
    await sync();
  }

  const members2 = new Map<string, Community>(members.map((m) => [m.me, m]));
  /** The record as the creator's replica holds it now. */
  const view = async (): Promise<ViewReader> => {
    await community.space.update();
    return community.space.view;
  };
  return {
    network,
    creator,
    community,
    key,
    admit,
    sync,
    recordAt,
    coTreasurers,
    members,
    members2,
    view,
  };
}
type Town = Awaited<ReturnType<typeof town>>;

/** Writes one event as its actor through their own replica. Returns its record id and the record's refusal, if any. */
async function writeAs(
  t: Town,
  who: Phone,
  type: string,
  payload: Record<string, unknown>,
  claimedAt: number,
  raw = false,
): Promise<{ id: string; rejected?: string }> {
  const space = t.members2.get(who.did)?.space ?? t.community.space;
  const fields = {
    type,
    space: t.key,
    actor: who.did,
    proof: [],
    claimedAt,
    nonce: randomHex(16),
    payload,
  };
  const event = (raw ? { v: 1, ...fields } : createEvent(fields as never)) as EventEnvelope;
  const receipt = await space.append(event);
  if (!receipt.ok) throw new Error(receipt.error.message);
  await space.update();
  // The Node reads the creator's replica, so the write reaches it before anything is judged.
  await t.sync();
  const marker = (await t.community.space.view.get(`rejected/${receipt.value.id}`)) as
    | { reason?: string }
    | undefined;
  return marker?.reason === undefined
    ? { id: receipt.value.id }
    : { id: receipt.value.id, rejected: marker.reason };
}

/** The bank commitment the Node makes of `BANK` for this community and supplier (what the approvers sign). */
function commitmentOf(t: Town, supplier = SUPPLIER): string {
  return bankCommitmentOf(COMMIT_KEY, t.key, supplier, BANK);
}

/** A quote for `supplier` on `order`, then the treasurer's payment of `minor` cents. Returns the payment's record id. */
async function recordPayment(
  t: Town,
  minor: number,
  order = ORDER,
  supplier = SUPPLIER,
  at = T0 + DAYS(3),
) {
  await t.recordAt(at);
  const quote = await t.community.addQuote(
    {
      supplier,
      order,
      lines: [{ item: "Sugar", unit: "bag", packSize: 1, pricePerPackCents: minor }],
      delivery: { feeCents: 0, days: 0 },
    },
    at,
  );
  if (!quote.ok) throw new Error(quote.error.message);
  const payment = await writeAs(
    t,
    t.creator,
    PAYOUT_TYPE,
    {
      order,
      supplier,
      amount: { currency: "ZAR", minor },
      recommendation: "clear",
      bank: commitmentOf(t, supplier),
    },
    at,
  );
  if (payment.rejected !== undefined) throw new Error(payment.rejected);
  await t.sync();
  return payment.id;
}

/** `who` approves the payment on their own phone, signing the terms for this community and this payment. */
async function approveAs(
  t: Town,
  who: Phone,
  payment: string,
  minor: number,
  order = ORDER,
  supplier = SUPPLIER,
  at = T0 + DAYS(3),
) {
  const signed = await who.auth.sign(
    who.did,
    approvalBytes(t.key, payment, who.did, {
      order,
      supplier,
      amountMinor: minor,
      bank: commitmentOf(t, supplier),
    }),
  );
  if (!signed.ok) throw new Error("sign failed");
  return writeAs(
    t,
    who,
    APPROVAL_TYPE,
    {
      payout: payment,
      order,
      supplier,
      amount: { currency: "ZAR", minor },
      bank: commitmentOf(t, supplier),
      signature: signed.value,
    },
    at,
  );
}

/** The Node's hub over the record: the view is the creator's replica; the Node's writes go through the creator. */
class RecordHub implements PayoutHub {
  readonly mirrored: EventEnvelope[] = [];
  readonly t: Town;
  constructor(t: Town) {
    this.t = t;
  }
  registrationOf(key: string) {
    return key === this.t.key ? { spaceKey: key, creator: this.t.creator.did } : undefined;
  }
  async isMember(did: Did, key: string) {
    if (key !== this.t.key) return undefined;
    return (await this.t.view()).get(`members/${did}`).then((v) => v !== undefined);
  }
  async indexedView(key: string) {
    return key === this.t.key ? this.t.view() : undefined;
  }
  creatorOf(key: string) {
    return key === this.t.key ? this.t.creator.did : undefined;
  }
  async mirror(key: string, event: EventEnvelope) {
    if (key !== this.t.key) return undefined;
    const space = this.t.community.space;
    const receipt = await space.append(event);
    if (!receipt.ok) return undefined;
    await space.update();
    this.mirrored.push(event);
    const marker = (await space.view.get(`rejected/${receipt.value.id}`)) as
      | { reason?: string }
      | undefined;
    return marker === undefined
      ? { id: receipt.value.id, duplicate: false }
      : { id: receipt.value.id, duplicate: false, rejected: marker.reason };
  }
}

interface Harness {
  app: ReturnType<typeof buildApp>;
  t: Town;
  hub: RecordHub;
  ledger: Ledger;
  store: PayoutStore;
  now: { value: number };
  logs: string[];
  bank: { down: boolean };
  /** Every payout the bank was asked to create, as the Node sent it. */
  bankCalls: { externalReference: string; approvers: readonly string[] }[];
  auth: IsoUcanCapabilityAuth;
  folder: string;
  /** The simulated bank the Node pays through. */
  simulated: SimulatedStitch;
}

/**
 * The Node around one community. `funds` is the pool's balance at the start. A `reuse` harness keeps its ledger, hub and
 * folder, so a second Node (with a reopened store) can be started on the same books, as after a restart.
 */
async function harness(
  t: Town,
  options: { funds?: number; store?: PayoutStore; reuse?: Harness; stateFile?: string } = {},
): Promise<Harness> {
  const reuse = options.reuse;
  const folder = reuse?.folder ?? mkdtempSync(join(tmpdir(), "ocn-payouts-"));
  if (reuse === undefined) folders.push(folder);
  const now = reuse?.now ?? { value: T0 + DAYS(3) };
  const logs: string[] = reuse?.logs ?? [];
  const sink: LogSink = { write: (line) => void logs.push(line) };
  const auth = new IsoUcanCapabilityAuth();
  const simulated: SimulatedStitch = createSimulatedStitch({
    webhookKey: new Uint8Array(32).map((_, i) => (i * 11 + 7) & 0xff),
    hmac: nodeHmacSha512,
    clock: { now: () => now.value },
    stateFile: options.stateFile ?? join(folder, "payments-simulated.json"),
    log: (line) => logs.push(line),
  });
  const bank = reuse?.bank ?? { down: false };
  const bankCalls: Harness["bankCalls"] = reuse?.bankCalls ?? [];
  const payOut = new Proxy(simulated.payOut, {
    get(target, property) {
      if (property === "createPayout") {
        return async (input: {
          externalReference: string;
          approval: { approvers: readonly string[] };
        }) => {
          if (bank.down)
            return {
              ok: false,
              error: { code: "invalid_request", message: "the bank is not answering" },
            };
          bankCalls.push({
            externalReference: input.externalReference,
            approvers: input.approval.approvers,
          });
          return (target.createPayout as (i: unknown) => unknown)(input);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function"
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  });
  const ledger =
    reuse?.ledger ??
    openSqliteLedger({ path: join(folder, "ledger.sqlite"), clock: { now: () => T0 } });
  if (reuse === undefined) {
    await configureChart(ledger, t.key);
    if (options.funds !== undefined && options.funds > 0) {
      const funded = await ledger.post({
        idempotencyKey: randomHex(64),
        description: "Pool funded (test)",
        entries: [
          {
            account: poolAccountOf(t.key),
            direction: "debit",
            amount: { currency: "ZAR", minor: options.funds },
          },
          {
            account: feesOf(t.key),
            direction: "credit",
            amount: { currency: "ZAR", minor: options.funds },
          },
        ],
      });
      if (!funded.ok) throw new Error(funded.error.message);
    }
  }
  const hub = reuse?.hub ?? new RecordHub(t);
  const store = options.store ?? reuse?.store ?? createMemoryPayoutStore();
  const payouts: PayoutOptions = {
    auth,
    clock: () => now.value,
    hub,
    ledger,
    payments: { ...simulated, payOut: payOut as never },
    nodeIdentity: NODE_IDENTITY,
    store,
    commitmentKey: COMMIT_KEY,
  };
  const app = buildApp({
    logger: createLogger({ level: "info", sink }),
    version: "test",
    components: [],
    auth,
    payouts,
  });
  await app.ready();
  return { app, t, hub, ledger, store, now, logs, bank, bankCalls, auth, folder, simulated };
}

/** A request signed by `who` at the Node's clock, sent to the Node. */
async function call(
  h: Harness,
  who: Phone,
  method: "GET" | "POST",
  url: string,
  body?: unknown,
  nonce = randomHex(16),
) {
  const text = body === undefined ? "" : JSON.stringify(body);
  const parts: RequestParts = {
    method,
    path: url,
    body: text,
    nonce,
    time: h.now.value,
    actor: who.did,
  };
  const signed = await signRequest(who.auth, parts, webCryptoSha512);
  if (!signed.ok) throw new Error(signed.error.message);
  const response = await h.app.inject({
    method,
    url,
    headers: {
      ...(signed.value as unknown as Record<string, string>),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { payload: text }),
  });
  return { status: response.statusCode, body: response.json() as Record<string, unknown> };
}

const pay = (h: Harness, who: Phone, payment: string, nonce?: string) =>
  call(h, who, "POST", "/payouts", { community: h.t.key, payout: payment }, nonce);

const pool = async (h: Harness) =>
  Number((await h.ledger.balance(poolAccountOf(h.t.key), "ZAR")).balance.minor);

const bankDetails = (h: Harness, who: Phone, supplier = SUPPLIER, bank = BANK) =>
  call(h, who, "POST", "/suppliers/bank", { community: h.t.key, supplier, ...bank });

/** The record holds nothing that could show the account: the view, every mirrored event and the logs are searched. */
async function recordAndLogsText(h: Harness): Promise<string> {
  const view = await h.t.view();
  const entries = await view.list("");
  return JSON.stringify(entries) + JSON.stringify(h.hub.mirrored) + h.logs.join("\n");
}

describe("POST /payouts: a payment with enough approvals, the pool and one posting [S-4.7]", () => {
  it("posts once and creates one payout, both keyed by the payment's event id, and says it is simulated", async () => {
    const t = await town({ coTreasurers: 1, limit: 1000 });
    const payment = await recordPayment(t, 50_000);
    expect((await approveAs(t, t.creator, payment, 50_000)).rejected).toBeUndefined();
    expect((await approveAs(t, t.coTreasurers[0]!, payment, 50_000)).rejected).toBeUndefined();
    const h = await harness(t, { funds: 80_000 });
    expect((await bankDetails(h, t.creator)).status).toBe(200);

    const sent = await pay(h, t.creator, payment);
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({
      simulated: true,
      status: "pending",
      payout: payment,
      supplier: SUPPLIER,
      amountMinor: 50_000,
    });
    expect(sent.body.reason).toBe(
      "Payment sent to Makro Soweto (simulated). No real money has moved. The bank's final answer is not checked yet.",
    );
    expect(await pool(h)).toBe(30_000);
    expect(
      h.hub.mirrored.filter(
        (e) => e.type === "ledger.posted" && (e.payload as { key?: string }).key === payment,
      ),
    ).toHaveLength(1);
    // The approvers come in the record's key order, which is random per run: compare them as a set.
    expect(h.bankCalls).toHaveLength(1);
    expect(h.bankCalls[0]?.externalReference).toBe(payment);
    expect([...(h.bankCalls[0]?.approvers ?? [])].sort()).toEqual(
      [t.creator.did, t.coTreasurers[0]!.did].sort(),
    );
    expect(h.store.payoutOf(payment)?.state).toBe("sent");
  });

  it("a retry of the same payment with a new signed request gives the first answer: no second posting or payout", async () => {
    const t = await town({ coTreasurers: 1 });
    const payment = await recordPayment(t, 50_000);
    await approveAs(t, t.creator, payment, 50_000);
    await approveAs(t, t.coTreasurers[0]!, payment, 50_000);
    const h = await harness(t, { funds: 80_000 });
    await bankDetails(h, t.creator);
    const first = await pay(h, t.creator, payment);
    const again = await pay(h, t.creator, payment);
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(again.body.replayed).toBe(true);
    expect(again.body.reason).toBe(first.body.reason);
    expect(await pool(h)).toBe(30_000);
    expect(h.hub.mirrored.filter((e) => e.type === "ledger.posted")).toHaveLength(1);
    expect(h.bankCalls).toHaveLength(1);
  });

  it("a replayed signed request is refused: 'That request was already used.'", async () => {
    const t = await town({ coTreasurers: 1 });
    const payment = await recordPayment(t, 50_000);
    await approveAs(t, t.creator, payment, 50_000);
    await approveAs(t, t.coTreasurers[0]!, payment, 50_000);
    const h = await harness(t, { funds: 80_000 });
    await bankDetails(h, t.creator);
    const nonce = randomHex(16);
    expect((await pay(h, t.creator, payment, nonce)).status).toBe(200);
    const replay = await pay(h, t.creator, payment, nonce);
    expect(replay.status).toBe(409);
    expect(replay.body.reason).toBe("That request was already used. (simulated)");
    expect(h.hub.mirrored.filter((e) => e.type === "ledger.posted")).toHaveLength(1);
  });
});

describe("POST /payouts: refusals leave the books and the bank untouched [S-4.7]", () => {
  it("one approval when two are needed: 'Two people must approve this payment.', nothing posted or paid", async () => {
    const t = await town({ coTreasurers: 1 });
    const payment = await recordPayment(t, 50_000);
    await approveAs(t, t.creator, payment, 50_000);
    const h = await harness(t, { funds: 80_000 });
    await bankDetails(h, t.creator);
    const refused = await pay(h, t.creator, payment);
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({
      problem: "not_enough_approvals",
      reason: "Two people must approve this payment. (simulated)",
    });
    expect(await pool(h)).toBe(80_000);
    expect(h.hub.mirrored).toHaveLength(0);
    expect(h.bankCalls).toHaveLength(0);
  });

  it("an approver over their limit is not counted: nothing is posted or paid", async () => {
    const t = await town({ coTreasurers: 1, limit: 1000 });
    const payment = await recordPayment(t, 150_000);
    await approveAs(t, t.creator, payment, 150_000);
    const over = await approveAs(t, t.coTreasurers[0]!, payment, 150_000);
    expect(over.rejected).toBe("That is above your limit of R1000.");
    const h = await harness(t, { funds: 200_000 });
    await bankDetails(h, t.creator);
    const refused = await pay(h, t.creator, payment);
    expect(refused.status).toBe(422);
    expect(refused.body.reason).toBe("Two people must approve this payment. (simulated)");
    expect(await pool(h)).toBe(200_000);
    expect(h.bankCalls).toHaveLength(0);
  });

  it("an approver whose role ended before the Node's clock is not counted: 'Your role ended on <date>.'", async () => {
    const t = await town({ coTreasurers: 1, limit: 1000, days: 7 });
    const payment = await recordPayment(t, 50_000);
    await approveAs(t, t.creator, payment, 50_000);
    expect((await approveAs(t, t.coTreasurers[0]!, payment, 50_000)).rejected).toBeUndefined();
    const h = await harness(t, { funds: 80_000 });
    await bankDetails(h, t.creator);
    h.now.value = T0 + DAYS(10);
    const refused = await pay(h, t.creator, payment);
    expect(refused.status).toBe(422);
    expect(refused.body.reason).toMatch(/^Your role ended on /);
    expect(h.bankCalls).toHaveLength(0);
  });

  it("an approver whose role was taken back after they approved is not counted", async () => {
    const t = await town({ coTreasurers: 1, limit: 1000 });
    const co = t.coTreasurers[0]!;
    const payment = await recordPayment(t, 50_000);
    await approveAs(t, t.creator, payment, 50_000);
    await approveAs(t, co, payment, 50_000);
    await writeAs(
      t,
      t.creator,
      "role.revoked",
      { role: "co-treasurer", grantee: co.did },
      T0 + DAYS(3),
    );
    await t.sync();
    const h = await harness(t, { funds: 80_000 });
    await bankDetails(h, t.creator);
    const refused = await pay(h, t.creator, payment);
    expect(refused.status).toBe(422);
    expect(refused.body.reason).toBe("This role has been taken back. (simulated)");
    expect(h.bankCalls).toHaveLength(0);
  });

  it("short funds: both amounts are named, nothing is posted or paid", async () => {
    const t = await town({ coTreasurers: 1 });
    const payment = await recordPayment(t, 50_000);
    await approveAs(t, t.creator, payment, 50_000);
    await approveAs(t, t.coTreasurers[0]!, payment, 50_000);
    const h = await harness(t, { funds: 30_000 });
    await bankDetails(h, t.creator);
    const refused = await pay(h, t.creator, payment);
    expect(refused.status).toBe(422);
    expect(refused).toMatchObject({
      body: {
        problem: "short_funds",
        reason: "The pool has R300.00; this payment needs R500.00. Nothing was paid. (simulated)",
      },
    });
    expect(await pool(h)).toBe(30_000);
    expect(h.hub.mirrored).toHaveLength(0);
    expect(h.bankCalls).toHaveLength(0);
  });

  it("no bank details for the supplier: nothing is posted", async () => {
    const t = await town({ coTreasurers: 1 });
    const payment = await recordPayment(t, 50_000);
    await approveAs(t, t.creator, payment, 50_000);
    await approveAs(t, t.coTreasurers[0]!, payment, 50_000);
    const h = await harness(t, { funds: 80_000 });
    const refused = await pay(h, t.creator, payment);
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({
      problem: "no_bank_details",
      reason: "Add this supplier's bank details first. (simulated)",
    });
    expect(h.hub.mirrored).toHaveLength(0);
  });

  it("a payment the record does not hold is refused, as is a community the Node does not hold", async () => {
    const t = await town({ coTreasurers: 1 });
    const h = await harness(t, { funds: 80_000 });
    expect((await pay(h, t.creator, "ab".repeat(64))).body.reason).toBe(
      "This payment is not in the record. (simulated)",
    );
    const elsewhere = await call(h, t.creator, "POST", "/payouts", {
      community: "ef".repeat(32),
      payout: "ab".repeat(64),
    });
    expect(elsewhere.status).toBe(404);
  });

  it("a member who is not the treasurer cannot pay, even with every approval", async () => {
    const t = await town({ coTreasurers: 1 });
    const member = await phone();
    await t.admit(member);
    const payment = await recordPayment(t, 50_000);
    await approveAs(t, t.creator, payment, 50_000);
    await approveAs(t, t.coTreasurers[0]!, payment, 50_000);
    const h = await harness(t, { funds: 80_000 });
    await bankDetails(h, t.creator);
    const refused = await pay(h, member, payment);
    expect(refused.status).toBe(403);
    expect(refused.body.reason).toBe("Only the treasurer can pay a supplier. (simulated)");
    expect(h.bankCalls).toHaveLength(0);
  });

  it("a second payment to a supplier for the same order is refused once the first was sent", async () => {
    const t = await town({ coTreasurers: 1 });
    const first = await recordPayment(t, 50_000, ORDER, SUPPLIER, T0 + DAYS(3));
    await approveAs(t, t.creator, first, 50_000);
    await approveAs(t, t.coTreasurers[0]!, first, 50_000);
    const h = await harness(t, { funds: 200_000 });
    await bankDetails(h, t.creator);
    expect((await pay(h, t.creator, first)).status).toBe(200);
    const second = await recordPayment(t, 50_000, ORDER, SUPPLIER, T0 + DAYS(4));
    await approveAs(t, t.creator, second, 50_000, ORDER, SUPPLIER, T0 + DAYS(4));
    await approveAs(t, t.coTreasurers[0]!, second, 50_000, ORDER, SUPPLIER, T0 + DAYS(4));
    const again = await pay(h, t.creator, second);
    expect(again.status).toBe(409);
    expect(again.body.reason).toBe(
      "This supplier has already been paid for this order. (simulated)",
    );
    expect(h.bankCalls).toHaveLength(1);
  });
});

describe("POST /payouts: a payout that fails and is retried is created once [S-4.7]", () => {
  it("a refused bank keeps the posting; the retry creates the payout once and posts nothing again", async () => {
    const t = await town({ coTreasurers: 1 });
    const payment = await recordPayment(t, 50_000);
    await approveAs(t, t.creator, payment, 50_000);
    await approveAs(t, t.coTreasurers[0]!, payment, 50_000);
    const h = await harness(t, { funds: 80_000 });
    await bankDetails(h, t.creator);
    h.bank.down = true;
    const failed = await pay(h, t.creator, payment);
    expect(failed.status).toBe(422);
    expect(failed.body.problem).toBe("payout_failed");
    expect(await pool(h)).toBe(30_000);
    // Shown as failed until a retry or the reconciler (plan question 8); the posting itself stays.
    expect(h.store.payoutOf(payment)?.state).toBe("failed");
    h.bank.down = false;
    const retried = await pay(h, t.creator, payment);
    expect(retried.body).toMatchObject({ simulated: true });
    expect(retried.status).toBe(200);
    expect(h.hub.mirrored.filter((e) => e.type === "ledger.posted")).toHaveLength(1);
    expect(h.bankCalls).toHaveLength(1);
    expect(await pool(h)).toBe(30_000);
  });

  it("after a restart (the store reopened from its file) a sent payout is not paid again", async () => {
    const t = await town({ coTreasurers: 1 });
    const payment = await recordPayment(t, 50_000);
    await approveAs(t, t.creator, payment, 50_000);
    await approveAs(t, t.coTreasurers[0]!, payment, 50_000);
    const stateFile = join(mkdtempSync(join(tmpdir(), "ocn-payout-state-")), "payouts-state.json");
    folders.push(stateFile);
    const first = await harness(t, { funds: 80_000, store: openPayoutStore(stateFile) });
    await bankDetails(first, t.creator);
    expect((await pay(first, t.creator, payment)).status).toBe(200);
    const restarted = await harness(t, { reuse: first, store: openPayoutStore(stateFile) });
    const again = await pay(restarted, t.creator, payment);
    expect(again.status).toBe(200);
    expect(again.body.replayed).toBe(true);
    expect(restarted.bankCalls).toHaveLength(1);
    expect(restarted.hub.mirrored.filter((e) => e.type === "ledger.posted")).toHaveLength(1);
  });
});

describe("the approvals a payment needs: every N from 1 to 5 and the default", () => {
  it.each([1, 2, 3, 4, 5])(
    "with N = %i, N people approving pay, and one fewer is refused",
    { timeout: 120_000 },
    async (n) => {
      const t = await town({ approvals: n, coTreasurers: n - 1, limit: 2000 });
      const people = [t.creator, ...t.coTreasurers];
      const pass = await recordPayment(t, 50_000, `${ORDER} ${n}`, SUPPLIER, T0 + DAYS(3));
      for (const who of people.slice(0, n)) {
        expect(
          (await approveAs(t, who, pass, 50_000, `${ORDER} ${n}`, SUPPLIER, T0 + DAYS(3))).rejected,
        ).toBeUndefined();
      }
      const fail = await recordPayment(t, 50_000, `${ORDER} short ${n}`, SUPPLIER, T0 + DAYS(4));
      for (const who of people.slice(0, n - 1)) {
        await approveAs(t, who, fail, 50_000, `${ORDER} short ${n}`, SUPPLIER, T0 + DAYS(4));
      }
      const h = await harness(t, { funds: 200_000 });
      await bankDetails(h, t.creator);
      await bankDetails(h, t.creator, SUPPLIER);
      const paid = await pay(h, t.creator, pass);
      expect(paid.status).toBe(200);
      const refused = await pay(h, t.creator, fail);
      expect(refused.status).toBe(422);
      expect(refused.body.reason).toBe(
        n === 1
          ? "One person must approve this payment. (simulated)"
          : `${["", "One", "Two", "Three", "Four", "Five"][n]} people must approve this payment. (simulated)`,
      );
    },
  );

  it("the default is two: one approval is refused, two pay", async () => {
    const t = await town({ coTreasurers: 1 });
    const payment = await recordPayment(t, 50_000);
    await approveAs(t, t.creator, payment, 50_000);
    await approveAs(t, t.coTreasurers[0]!, payment, 50_000);
    const h = await harness(t, { funds: 80_000 });
    await bankDetails(h, t.creator);
    expect((await pay(h, t.creator, payment)).status).toBe(200);
  });
});

describe("supplier bank details: typed by the treasurer, kept on the Node only [S-4.7]", () => {
  it("are saved for the treasurer; the answer and the record and the logs never show the account", async () => {
    const t = await town({ coTreasurers: 1 });
    const h = await harness(t, { funds: 0 });
    const saved = await bankDetails(h, t.creator);
    expect(saved.status).toBe(200);
    expect(JSON.stringify(saved.body)).not.toContain(ACCOUNT);
    const text = await recordAndLogsText(h);
    expect(text).not.toContain(ACCOUNT);
    expect(text).not.toContain("fnb");
  });

  it("are refused from a member who is not the treasurer", async () => {
    const t = await town({ coTreasurers: 1 });
    const member = await phone();
    await t.admit(member);
    const h = await harness(t, { funds: 0 });
    const refused = await bankDetails(h, member);
    expect(refused.status).toBe(403);
    expect(refused.body.reason).toBe("Only the treasurer can pay a supplier. (simulated)");
  });

  it("are refused when the account number is not 6 to 16 digits, with no account in the answer", async () => {
    const t = await town({ coTreasurers: 1 });
    const h = await harness(t, { funds: 0 });
    const refused = await bankDetails(h, t.creator, SUPPLIER, {
      ...BANK,
      accountNumber: "12 34-5",
    });
    expect(refused.status).toBe(422);
    expect(JSON.stringify(refused.body)).not.toContain("12 34-5");
  });

  it("are written to the Node's own store, keyed by the supplier", async () => {
    const t = await town({ coTreasurers: 1 });
    const stateFile = join(mkdtempSync(join(tmpdir(), "ocn-bank-state-")), "payouts-state.json");
    folders.push(stateFile);
    const h = await harness(t, { funds: 0, store: openPayoutStore(stateFile) });
    await bankDetails(h, t.creator);
    expect(readFileSync(stateFile, "utf8")).toContain(ACCOUNT);
    expect(h.store.bankOf(t.key, SUPPLIER)).toMatchObject({
      bankId: "fnb",
      accountNumber: ACCOUNT,
    });
  });
});

/** A store whose next `savePayout` throws once: the crash between the posting and the Node's own record (fix 1). */
function failingSaveOnce(inner: PayoutStore): PayoutStore {
  let armed = true;
  return {
    ...inner,
    savePayout(record) {
      if (armed) {
        armed = false;
        throw new Error("disk full (test)");
      }
      inner.savePayout(record);
    },
  };
}

describe("a crash after the posting is resumed, not stranded [S-4.7 fix 1]", () => {
  it("a failed save after the posting: the retry resumes, creates one payout, and the pool shows R300", async () => {
    const t = await town({ coTreasurers: 1 });
    const payment = await recordPayment(t, 50_000);
    await approveAs(t, t.creator, payment, 50_000);
    await approveAs(t, t.coTreasurers[0]!, payment, 50_000);
    const store = failingSaveOnce(createMemoryPayoutStore());
    const h = await harness(t, { funds: 80_000, store });
    await bankDetails(h, t.creator);
    const first = await pay(h, t.creator, payment);
    expect(first.status).toBe(503);
    expect(await pool(h)).toBe(30_000);
    const retried = await pay(h, t.creator, payment);
    expect(retried.body).toMatchObject({ simulated: true });
    expect(retried.status).toBe(200);
    expect(await pool(h)).toBe(30_000);
    expect(h.hub.mirrored.filter((e) => e.type === "ledger.posted")).toHaveLength(1);
    expect(h.bankCalls).toHaveLength(1);
  });

  it("a restart after the posting (the Node's table is gone): the retry resumes from the books and pays once", async () => {
    const t = await town({ coTreasurers: 1 });
    const payment = await recordPayment(t, 50_000);
    await approveAs(t, t.creator, payment, 50_000);
    await approveAs(t, t.coTreasurers[0]!, payment, 50_000);
    const stateFile = join(mkdtempSync(join(tmpdir(), "ocn-restart-")), "payouts-state.json");
    folders.push(stateFile);
    const crashed = await harness(t, {
      funds: 80_000,
      store: failingSaveOnce(openPayoutStore(stateFile)),
    });
    await bankDetails(crashed, t.creator);
    expect((await pay(crashed, t.creator, payment)).status).toBe(503);
    // The restart reopens the Node's own file: the bank details are there, the failed save is not.
    const restarted = await harness(t, { reuse: crashed, store: openPayoutStore(stateFile) });
    const retried = await pay(restarted, t.creator, payment);
    expect(retried.body).toMatchObject({ simulated: true });
    expect(retried.status).toBe(200);
    expect(await pool(restarted)).toBe(30_000);
    expect(restarted.hub.mirrored.filter((e) => e.type === "ledger.posted")).toHaveLength(1);
    expect(restarted.bankCalls).toHaveLength(1);
  });
});

describe("two requests at once cannot pay twice [S-4.7 fix 2]", () => {
  it("two identical requests sent together give one payout", async () => {
    const t = await town({ coTreasurers: 1 });
    const payment = await recordPayment(t, 50_000);
    await approveAs(t, t.creator, payment, 50_000);
    await approveAs(t, t.coTreasurers[0]!, payment, 50_000);
    const h = await harness(t, { funds: 200_000 });
    await bankDetails(h, t.creator);
    await Promise.all([pay(h, t.creator, payment), pay(h, t.creator, payment)]);
    expect(h.bankCalls).toHaveLength(1);
    expect(h.hub.mirrored.filter((e) => e.type === "ledger.posted")).toHaveLength(1);
    expect(await pool(h)).toBe(150_000);
  });

  it("two different payments to one supplier for one order, sent together: one is paid, the other refused", async () => {
    const t = await town({ coTreasurers: 1 });
    const first = await recordPayment(t, 50_000, ORDER, SUPPLIER, T0 + DAYS(3));
    await approveAs(t, t.creator, first, 50_000, ORDER, SUPPLIER, T0 + DAYS(3));
    await approveAs(t, t.coTreasurers[0]!, first, 50_000, ORDER, SUPPLIER, T0 + DAYS(3));
    const second = await recordPayment(t, 50_000, ORDER, SUPPLIER, T0 + DAYS(4));
    await approveAs(t, t.creator, second, 50_000, ORDER, SUPPLIER, T0 + DAYS(4));
    await approveAs(t, t.coTreasurers[0]!, second, 50_000, ORDER, SUPPLIER, T0 + DAYS(4));
    const h = await harness(t, { funds: 200_000 });
    await bankDetails(h, t.creator);
    const [a, b] = await Promise.all([pay(h, t.creator, first), pay(h, t.creator, second)]);
    const statuses = [a.status, b.status].sort((x, y) => x - y);
    expect(statuses).toEqual([200, 409]);
    const refused = a.status === 409 ? a : b;
    expect(refused.body.reason).toBe(
      "This supplier has already been paid for this order. (simulated)",
    );
    expect(h.bankCalls).toHaveLength(1);
    expect(h.hub.mirrored.filter((e) => e.type === "ledger.posted")).toHaveLength(1);
  });
});

describe("the bank details an approval names are fixed [S-4.7 fix 3]", () => {
  it("a change made after the approvals is refused while the payment is approved: 'bank_locked'", async () => {
    const t = await town({ coTreasurers: 1 });
    const payment = await recordPayment(t, 50_000);
    await approveAs(t, t.creator, payment, 50_000);
    await approveAs(t, t.coTreasurers[0]!, payment, 50_000);
    const h = await harness(t, { funds: 80_000 });
    await bankDetails(h, t.creator);
    const changed = await bankDetails(h, t.creator, SUPPLIER, {
      ...BANK,
      accountNumber: "9876543210",
    });
    expect(changed.status).toBe(409);
    expect(changed.body.problem).toBe("bank_locked");
    expect(changed.body.reason).toBe(
      "Bank details cannot change while a payment to this supplier is approved or sent. Start a new payment to change them. (simulated)",
    );
  });

  it("a change made before any approval is seen at payment time: the approvals signed for the old details are not enough", async () => {
    const t = await town({ coTreasurers: 1 });
    const payment = await recordPayment(t, 50_000);
    const h = await harness(t, { funds: 80_000 });
    await bankDetails(h, t.creator);
    await bankDetails(h, t.creator, SUPPLIER, { ...BANK, accountNumber: "9876543210" });
    await approveAs(t, t.creator, payment, 50_000);
    await approveAs(t, t.coTreasurers[0]!, payment, 50_000);
    const refused = await pay(h, t.creator, payment);
    expect(refused.status).toBe(422);
    expect(refused.body.reason).toBe(
      "The bank details changed after the approvals. Ask for the approvals again. (simulated)",
    );
    expect(h.bankCalls).toHaveLength(0);
    expect(h.hub.mirrored.filter((e) => e.type === "ledger.posted")).toHaveLength(0);
  });

  it("the Node's commitment is keyed: it is not the details, and it changes with them", async () => {
    const t = await town({ coTreasurers: 1 });
    const h = await harness(t, { funds: 0 });
    await bankDetails(h, t.creator);
    const first = await call(
      h,
      t.creator,
      "GET",
      `/suppliers/bank/commitment?community=${t.key}&supplier=${encodeURIComponent(SUPPLIER)}`,
    );
    expect(first.status).toBe(200);
    expect(String(first.body.commitment)).toBe(commitmentOf(t));
    expect(JSON.stringify(first.body)).not.toContain(ACCOUNT);
  });
});

describe("a failed payment does not block a fresh one, and the one-time numbers and rate limit hold [S-4.7 fixes 9, 10]", () => {
  it("a failed payment does not block a fresh payment to the same supplier and order, and the failed one retries first", async () => {
    const t = await town({ coTreasurers: 1 });
    const first = await recordPayment(t, 50_000, ORDER, SUPPLIER, T0 + DAYS(3));
    await approveAs(t, t.creator, first, 50_000, ORDER, SUPPLIER, T0 + DAYS(3));
    await approveAs(t, t.coTreasurers[0]!, first, 50_000, ORDER, SUPPLIER, T0 + DAYS(3));
    const h = await harness(t, { funds: 200_000 });
    await bankDetails(h, t.creator);
    h.bank.down = true;
    expect((await pay(h, t.creator, first)).body.problem).toBe("payout_failed");
    h.bank.down = false;
    expect((await pay(h, t.creator, first)).status).toBe(200);
    const second = await recordPayment(t, 50_000, ORDER, SUPPLIER, T0 + DAYS(4));
    await approveAs(t, t.creator, second, 50_000, ORDER, SUPPLIER, T0 + DAYS(4));
    await approveAs(t, t.coTreasurers[0]!, second, 50_000, ORDER, SUPPLIER, T0 + DAYS(4));
    expect((await pay(h, t.creator, second)).body.reason).toBe(
      "This supplier has already been paid for this order. (simulated)",
    );
  });

  it("a refused signed request uses up its one-time number: sending it again is a replay", async () => {
    const t = await town({ coTreasurers: 1 });
    const payment = await recordPayment(t, 50_000);
    const h = await harness(t, { funds: 80_000 });
    await bankDetails(h, t.creator);
    const nonce = randomHex(16);
    expect((await pay(h, t.creator, payment, nonce)).body.problem).toBe("not_enough_approvals");
    const again = await pay(h, t.creator, payment, nonce);
    expect(again.status).toBe(409);
    expect(again.body.problem).toBe("replayed");
  });

  it("more than the rate limit of payout calls in one window is refused", async () => {
    const t = await town({ coTreasurers: 1 });
    const payment = await recordPayment(t, 50_000);
    const h = await harness(t, { funds: 80_000 });
    let last = 0;
    for (let i = 0; i < 32; i++) last = (await pay(h, t.creator, payment)).status;
    expect(last).toBe(429);
  });
});

describe("a removed approver's approval does not count [S-4.7 fix 12]", () => {
  it("after the approver is removed, their approval is not counted and nothing is paid", async () => {
    const t = await town({ coTreasurers: 1 });
    const co = t.coTreasurers[0]!;
    const payment = await recordPayment(t, 50_000);
    await approveAs(t, t.creator, payment, 50_000);
    await approveAs(t, co, payment, 50_000);
    await writeAs(t, t.creator, "member.removed", { member: co.did }, T0 + DAYS(3));
    const h = await harness(t, { funds: 80_000 });
    await bankDetails(h, t.creator);
    const refused = await pay(h, t.creator, payment);
    expect(refused.status).toBe(422);
    // The short count shows the first refused approver's plain reason (the removed approver's approval).
    expect(refused.body.reason).toBe("Only a member can approve a payment. (simulated)");
    expect(h.bankCalls).toHaveLength(0);
  });
});

describe("an approval given before a removed person rejoined does not count [S-4.7 fix 12]", () => {
  it("after removal and a fresh admission, the old approval is refused and nothing is paid", async () => {
    const t = await town({ coTreasurers: 1 });
    const co = t.coTreasurers[0]!;
    const payment = await recordPayment(t, 50_000);
    await approveAs(t, t.creator, payment, 50_000);
    await approveAs(t, co, payment, 50_000);
    await writeAs(t, t.creator, "member.removed", { member: co.did }, T0 + DAYS(3));
    await t.admit(co, T0 + DAYS(4));
    const h = await harness(t, { funds: 80_000 });
    await bankDetails(h, t.creator);
    const refused = await pay(h, t.creator, payment);
    expect(refused.status).toBe(422);
    expect(refused.body.reason).toBe(
      "That approval was given before you rejoined. Ask for a fresh one. (simulated)",
    );
    expect(h.bankCalls).toHaveLength(0);
  });
});

/** The record as one member's own replica holds it, after the replicas have met. */
async function viewOf(t: Town, who: Phone): Promise<ViewReader> {
  await t.sync();
  const space = t.members2.get(who.did)!.space;
  await space.update();
  return space.view;
}

describe("Supplier paid, derived from the record on two replicas [story 8.5]", () => {
  /** A funded pool, a payment with two approvals (the treasurer and a co-treasurer), and the supplier's bank details. */
  async function ready(funds = 80_000, amount = 50_000) {
    const t = await town({ approvals: 2, coTreasurers: 1, limit: 1000 });
    const payment = await recordPayment(t, amount);
    await approveAs(t, t.creator, payment, amount);
    await approveAs(t, t.coTreasurers[0]!, payment, amount);
    const h = await harness(t, { funds });
    expect((await bankDetails(h, t.creator)).status).toBe(200);
    return { t, h, payment, amount };
  }

  it("nothing says 'Supplier paid' before the payment is sent, on either replica", async () => {
    const { t } = await ready();
    expect(await paidPayoutsOf(await viewOf(t, t.creator))).toEqual([]);
    expect(await paidPayoutsOf(await viewOf(t, t.coTreasurers[0]!))).toEqual([]);
  });

  it("after the payment, the creator's replica and the co-treasurer's replica derive the same paid payment", async () => {
    const { t, h, payment, amount } = await ready();
    expect((await pay(h, t.creator, payment)).status).toBe(200);
    const mine = await paidPayoutsOf(await viewOf(t, t.creator));
    const theirs = await paidPayoutsOf(await viewOf(t, t.coTreasurers[0]!));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      payout: payment,
      order: ORDER,
      supplier: SUPPLIER,
      amountMinor: amount,
    });
    expect(theirs).toEqual(mine);
  });

  it("the pool view shows 'Supplier paid' to a member, the amount, and that it is simulated", async () => {
    const { t, h, payment, amount } = await ready();
    await pay(h, t.creator, payment);
    const paid = await paidPayoutsOf(await viewOf(t, t.coTreasurers[0]!));
    const books = { pool: BigInt(await pool(h)), members: new Map<string, bigint>() };
    const view = poolView({
      currency: "ZAR",
      books,
      record: books,
      memberIds: ["a", "b"],
      you: "a",
      target: BigInt(amount),
      paid,
    });
    expect(view.supplierPaid).toMatchObject({
      supplier: SUPPLIER,
      order: ORDER,
      amount: { minor: "50000", text: "R500.00" },
      text: "Supplier paid: Makro Soweto was paid R500.00 from the pool.",
      note: "Test payment (simulated): no real money moved.",
    });
    expect(view.funding).toBeNull();
    // Before any payment the same inputs show nothing.
    expect(
      poolView({ currency: "ZAR", books, record: books, memberIds: ["a"], you: "a", target: 1n })
        .supplierPaid,
    ).toBeNull();
  });

  it("the same request twice leaves one posting, one payout and one 'Supplier paid'", async () => {
    const { t, h, payment } = await ready();
    await pay(h, t.creator, payment);
    await pay(h, t.creator, payment);
    expect(h.bankCalls).toHaveLength(1);
    expect(h.hub.mirrored.filter((e) => e.type === "ledger.posted")).toHaveLength(1);
    expect(await paidPayoutsOf(await viewOf(t, t.coTreasurers[0]!))).toHaveLength(1);
  });

  it("a short pool pays nothing and shows no 'Supplier paid'", async () => {
    const { t, h, payment } = await ready(30_000);
    const refused = await pay(h, t.creator, payment);
    expect(refused.status).not.toBe(200);
    expect(String(refused.body.reason)).toContain("Nothing was paid.");
    expect(await paidPayoutsOf(await viewOf(t, t.creator))).toEqual([]);
    expect(h.bankCalls).toHaveLength(0);
  });

  it("one approval where two are needed pays nothing and shows no 'Supplier paid'", async () => {
    const t = await town({ approvals: 2, coTreasurers: 1, limit: 1000 });
    const payment = await recordPayment(t, 50_000);
    await approveAs(t, t.creator, payment, 50_000);
    const h = await harness(t, { funds: 80_000 });
    await bankDetails(h, t.creator);
    const refused = await pay(h, t.creator, payment);
    expect(refused.status).not.toBe(200);
    expect(String(refused.body.reason)).toContain("Two people must approve this payment.");
    expect(await paidPayoutsOf(await viewOf(t, t.coTreasurers[0]!))).toEqual([]);
    expect(h.bankCalls).toHaveLength(0);
  });

  it("a member cannot make a payment look paid by writing a posting of their own", async () => {
    const { t, payment, amount } = await ready();
    const co = t.coTreasurers[0]!;
    await writeAs(
      t,
      co,
      "ledger.posted",
      {
        by: NODE_IDENTITY,
        key: payment,
        description: "Payment to a supplier (simulated)",
        entries: [
          {
            account: "liabilities:supplier/payable",
            direction: "debit",
            currency: "ZAR",
            minor: amount,
          },
        ],
      },
      T0 + DAYS(3),
    );
    expect(await paidPayoutsOf(await viewOf(t, t.creator))).toEqual([]);
  });

  it("a posting for another amount does not mark the payment as paid", async () => {
    const { t, payment, amount } = await ready();
    await writeAs(
      t,
      t.creator,
      "ledger.posted",
      {
        by: NODE_IDENTITY,
        key: payment,
        description: "Payment to a supplier (simulated)",
        entries: [
          {
            account: "liabilities:supplier/payable",
            direction: "debit",
            currency: "ZAR",
            minor: amount - 1,
          },
        ],
      },
      T0 + DAYS(3),
    );
    expect(await paidPayoutsOf(await viewOf(t, t.creator))).toEqual([]);
  });
});

describe("the ledger and the record agree after a payout [story 8.5]", () => {
  async function paidHarness() {
    const t = await town({ approvals: 2, coTreasurers: 1, limit: 1000 });
    const payment = await recordPayment(t, 50_000);
    await approveAs(t, t.creator, payment, 50_000);
    await approveAs(t, t.coTreasurers[0]!, payment, 50_000);
    const h = await harness(t, { funds: 80_000 });
    await bankDetails(h, t.creator);
    expect((await pay(h, t.creator, payment)).status).toBe(200);
    return { t, h, payment };
  }

  it("the posting's amount equals the payout's amount and the record's, and all three carry the event id", async () => {
    const { t, h, payment } = await paidHarness();
    const posting = await h.ledger.findByIdempotencyKey(payment);
    expect(posting?.idempotencyKey).toBe(payment);
    const booked = posting!.entries.find((e) => e.direction === "debit")!;
    expect(booked.amount.minor).toBe(50_000);

    const payout = h.simulated.payOut.payouts();
    expect(payout).toHaveLength(1);
    expect(payout[0]?.externalReference).toBe(payment);
    expect(payout[0]?.amount.minor).toBe(booked.amount.minor);

    const [recorded] = await paidPayoutsOf(await viewOf(t, t.coTreasurers[0]!));
    expect(recorded?.payout).toBe(payment);
    expect(recorded?.amountMinor).toBe(booked.amount.minor);
    const mirror = h.hub.mirrored.find((e) => (e.payload as { key?: string }).key === payment);
    expect(mirror).toBeDefined();
  });

  /** The reconciler's view of the Node: the one community, with the mirrored events as the creator's journal. */
  function reconcilerDeps(h: Harness, mirrored: readonly EventEnvelope[]): ReconcilerDeps {
    const hub = {
      heldCommunities: () => [h.t.key],
      creatorOf: () => h.t.creator.did,
      journalOf: async () =>
        mirrored.map((event, index) => ({
          position: index + 1,
          id: String(index),
          writer: h.t.creator.did,
          event,
        })),
    };
    return {
      simulated: h.simulated,
      ledger: h.ledger,
      hub: hub as unknown as ReconcilerDeps["hub"],
      masterKey: new Uint8Array(32),
      nodeIdentity: NODE_IDENTITY,
      store: {} as ReconcilerDeps["store"],
      now: () => T0,
      log: () => undefined,
    };
  }

  it("the reconciler lists nothing when the bank, the books and the record agree", async () => {
    const { h } = await paidHarness();
    expect(await reconcile(reconcilerDeps(h, h.hub.mirrored))).toEqual([]);
  });

  it("the reconciler flags a payout the record does not show, without paying again", async () => {
    const { h } = await paidHarness();
    const items = await reconcile(reconcilerDeps(h, []));
    expect(items.map((i) => i.kind)).toEqual(["payout_not_in_record"]);
    expect(items[0]?.text).toContain("Supplier paid");
    expect(items[0]?.text).toContain("(simulated)");
    expect(h.bankCalls).toHaveLength(1);
  });

  it("the reconciler flags a supplier payment the record shows but the bank never received", async () => {
    const { h, t } = await paidHarness();
    const bare = createSimulatedStitch({
      webhookKey: new Uint8Array(32).map((_, i) => (i * 11 + 7) & 0xff),
      hmac: nodeHmacSha512,
      clock: { now: () => T0 },
      stateFile: join(h.folder, "empty-bank.json"),
      log: () => undefined,
    });
    const deps = { ...reconcilerDeps(h, h.hub.mirrored), simulated: bare };
    const items = await reconcile(deps);
    expect(items.map((i) => i.kind)).toEqual(["record_paid_no_payout"]);
    expect(items[0]?.communityKey).toBe(t.key);
  });
});

describe("the demonstration pool: two approvers, a funded pool of R4,180.00 [story 8.5]", () => {
  it("is founded with two approvals and a co-treasurer whose limit covers the order, and pays once both approve", async () => {
    const TOTAL = 418_000;
    // The app's start-a-stokvel card suggests two approvals; the founding event writes the setting.
    const t = await town({ approvals: 2, coTreasurers: 1, limit: 5000 });
    expect(await approvalsOf(await t.view())).toBe(2);
    const payment = await recordPayment(t, TOTAL);
    await approveAs(t, t.creator, payment, TOTAL);
    const h = await harness(t, { funds: TOTAL });
    await bankDetails(h, t.creator);
    // One approval is not enough: nobody pays alone.
    const alone = await pay(h, t.creator, payment);
    expect(alone.status).not.toBe(200);
    expect(String(alone.body.reason)).toContain("Two people must approve this payment.");
    expect(await paidPayoutsOf(await viewOf(t, t.creator))).toEqual([]);
    // The co-treasurer's limit (R5,000.00) covers the order, so their approval counts and the pool pays.
    expect((await approveAs(t, t.coTreasurers[0]!, payment, TOTAL)).rejected).toBeUndefined();
    expect((await pay(h, t.creator, payment)).status).toBe(200);
    expect(await pool(h)).toBe(0);
    const [paid] = await paidPayoutsOf(await viewOf(t, t.coTreasurers[0]!));
    expect(paid?.amountMinor).toBe(TOTAL);
  });
});
