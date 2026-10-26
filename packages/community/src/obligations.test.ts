// Obligations (story 10.1): who owes whom what, by when, and its state, derived from the events on the record. Simulated
// phones on one in-memory record, as proof.test.ts does. Each obligation is checked at log time, never a wall clock.
import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import { createMemoryRecordNetwork, type MemoryRecordNetwork } from "@shopong/adapters-memory";
import {
  ENVELOPE_VERSION,
  routeFingerprint,
  webCryptoSha512,
  type EventEnvelope,
  type JsonObject,
} from "@shopong/events";
import type { Space } from "@shopong/ports";
import { describe, expect, it } from "vite-plus/test";
import {
  DAY_MS,
  OBLIGATION_GRACE_MS,
  OBLIGATION_LABELS,
  checkInvitation,
  communityDefinition,
  createCommunity,
  joinCommunity,
  logTimeOf,
  obligationsOf,
  selectionOf,
  stateOf,
  type Community,
  type CommunityDeps,
  type RoleDraft,
} from "./index.js";
import { coTreasurerJoinRecorded, isCurrentGrantIn } from "./roles.js";

const T0 = 1_793_000_000_000;
const DAYS = (n: number) => n * DAY_MS;
const DEADLINE = T0 + DAYS(10);
const COMMITMENT = "e".repeat(128);
const PHOTO = "f".repeat(128);
const BANK = "12".repeat(64);
const SUPPLIER = "Shop Two";

function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
}

async function phone() {
  const auth = new IsoUcanCapabilityAuth();
  const did = await auth.createIdentity();
  const deps: CommunityDeps = { auth, sha512: webCryptoSha512, randomBytes };
  return { auth, did, deps };
}

type Phone = Awaited<ReturnType<typeof phone>>;

/** One community on one record: the creator, and everyone admitted to it (as proof.test.ts does). */
async function town() {
  const network: MemoryRecordNetwork = createMemoryRecordNetwork();
  const creator = await phone();
  const made = await createCommunity(
    creator.deps,
    network.peer<EventEnvelope>(creator.did),
    "Ubuntu Savers",
    T0,
  );
  if (!made.ok) throw new Error(made.error.message);
  const community = made.value;
  const members: Community[] = [community];

  async function admit(p: Phone, now = T0): Promise<Community> {
    const invited = await community.invite(p.did, now);
    if (!invited.ok) throw new Error(invited.error.message);
    const space = await network
      .peer<EventEnvelope>(p.did)
      .open(community.space.key, communityDefinition(p.deps, creator.did, community.key));
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

  async function sync(): Promise<void> {
    for (let round = 0; round < 2; round++) {
      for (const member of members) {
        await network.replicate<EventEnvelope>(community.space, member.space);
      }
    }
  }

  return { network, creator, community, members, admit, sync };
}

type Town = Awaited<ReturnType<typeof town>>;

/** Brings log time up to `at` one day at a time, as real days would (the per-event cap, story 3.6). */
async function recordAt(t: Town, at: number): Promise<void> {
  for (let step = 0; step < 400; step++) {
    await t.community.space.update();
    const logTime = (await logTimeOf(t.community.space.view)) ?? T0;
    if (logTime >= at) break;
    const next = Math.min(at, logTime + DAY_MS);
    const added = await t.community.addQuote(
      {
        supplier: "Thandi Wholesale",
        order: `Log ${step}`,
        lines: [{ item: "Sugar", unit: "bag", packSize: 1, pricePerPackCents: 12500 }],
        delivery: { feeCents: 0, days: 0 },
      },
      next,
    );
    if (!added.ok) throw new Error(added.error.message);
  }
  await t.sync();
}

/** The creator proposes "o1" with a deadline and approves it, so pledges to it are open. */
async function openOrder(t: Town, at: number): Promise<void> {
  const proposed = await t.community.proposeOrder(
    {
      name: "o1",
      items: [{ item: "Sugar", quantity: 2 }],
      budgetPerMemberMinor: 50_000,
      deadline: DEADLINE,
    },
    at,
  );
  if (!proposed.ok) throw new Error(proposed.error.message);
  const approved = await t.community.approveOrder(proposed.value.id, at);
  if (!approved.ok) throw new Error(approved.error.message);
  await t.sync();
}

async function grantDriver(t: Town, grantee: Community, days: number, now: number) {
  await recordAt(t, now);
  const granted = await t.community.grantRole(grantee.me, "driver", { days }, now);
  if (!granted.ok) throw new Error(granted.error.message);
  await t.sync();
  return granted.value as RoleDraft;
}

const place = (letter: string) => ({
  id: letter.repeat(64),
  label: letter === "a" ? "Mamelodi Wholesale depot" : "Orlando community hall",
  area: "Soweto",
  addressCommitment: COMMITMENT,
});

/** A registered route for order `o1`: depot `a` to hall `b`, planned for `driver`. */
async function plan(t: Town, driver: Community, now: number) {
  await t.community.registerPlace(place("a"), T0);
  await t.community.registerPlace(place("b"), T0);
  const fingerprint = await routeFingerprint(
    "_p~iF~ps|U_ulLnnqC",
    "straight-line",
    webCryptoSha512,
  );
  const planned = await t.community.planDelivery(
    {
      order: "o1",
      driver: driver.me,
      origin: "a".repeat(64),
      destination: "b".repeat(64),
      route: {
        costing: "auto",
        distanceMeters: 12_400,
        durationSeconds: 1_500,
        tileRelease: "straight-line",
        fingerprint,
      },
    },
    now,
  );
  if (!planned.ok) throw new Error(planned.error.message);
  await t.sync();
}

/** Writes a raw event as the phone's own writer and returns the view's refusal for it, or undefined when accepted. */
async function rawRefusal(
  space: Space<EventEnvelope>,
  key: string,
  type: string,
  payload: JsonObject,
  at: number,
): Promise<string | undefined> {
  // A raw envelope, not `createEvent`: these rows test that the record refuses a bad payload too.
  const event = {
    v: ENVELOPE_VERSION,
    type,
    space: key,
    actor: space.local,
    proof: [],
    claimedAt: at,
    nonce: "0".repeat(32),
    payload,
  } as unknown as EventEnvelope;
  const receipt = await space.append(event);
  if (!receipt.ok) throw new Error(receipt.error.message);
  await space.update();
  const rejected = await space.view.get(`rejected/${receipt.value.id}`);
  if (rejected === undefined) return undefined;
  const reason = (rejected as JsonObject).reason;
  return typeof reason === "string" ? reason : undefined;
}

/** A member's pledge to order `o1`, written as the member's own event. Returns the record's refusal, if any. */
async function pledge(
  t: Town,
  member: Community,
  now: number,
  minor = 15000,
): Promise<string | undefined> {
  const refusal = await rawRefusal(
    member.space,
    t.community.key,
    "pledge.created",
    { order: "o1", member: member.me, amount: { currency: "ZAR", minor } },
    now,
  );
  await t.sync();
  return refusal;
}

const confirmation = (over: Record<string, unknown> = {}) => ({
  order: "o1",
  photoSha512: PHOTO,
  lat: "-25.71",
  lng: "28.40",
  ...over,
});

/** A quote for "o1" from the supplier, chosen by the treasurer, so the order has a supplier payment to make. */
async function chooseSupplierFor(t: Town, now: number): Promise<number> {
  const quote = await t.community.addQuote(
    {
      supplier: SUPPLIER,
      order: "o1",
      lines: [{ item: "Sugar", unit: "bag", packSize: 1, pricePerPackCents: 12500 }],
      delivery: { feeCents: 0, days: 0 },
    },
    now,
  );
  if (!quote.ok) throw new Error(quote.error.message);
  const chosen = await t.community.chooseSupplier("o1", SUPPLIER, now);
  if (!chosen.ok) throw new Error(chosen.error.message);
  await t.sync();
  const selection = await selectionOf(t.community.space.view, "o1");
  if (selection === undefined) throw new Error("no selection");
  return selection.totalMinor;
}

describe("the state of an obligation", () => {
  const by = T0 + DAYS(10);

  it("is open before its due day, due on it, overdue after the grace period", () => {
    expect(stateOf({ by, settled: false, now: by - 1 })).toBe("open");
    expect(stateOf({ by, settled: false, now: by })).toBe("due");
    expect(stateOf({ by, settled: false, now: by + OBLIGATION_GRACE_MS - 1 })).toBe("due");
    expect(stateOf({ by, settled: false, now: by + OBLIGATION_GRACE_MS })).toBe("overdue");
  });

  it("is settled whatever the date", () => {
    expect(stateOf({ by, settled: true, now: by - DAYS(30) })).toBe("settled");
    expect(stateOf({ by, settled: true, now: by + DAYS(30) })).toBe("settled");
  });

  it("uses plain words for each state", () => {
    expect(OBLIGATION_LABELS).toEqual({
      open: "Not due yet",
      due: "Due now",
      overdue: "Overdue",
      settled: "Paid",
    });
  });
});

describe("a pledge owes the pool", () => {
  it("is an open obligation from the member to the pool, due on the order's deadline", async () => {
    const t = await town();
    const member = await t.admit(await phone());
    await openOrder(t, T0 + DAY_MS);
    expect(await pledge(t, member, T0 + DAY_MS)).toBeUndefined();

    const owed = await obligationsOf(t.community.space.view, t.creator.did);
    expect(owed).toEqual([
      {
        id: expect.any(String),
        kind: "pledge",
        order: "o1",
        debtor: member.me,
        creditor: t.creator.did,
        amountMinor: 15000,
        currency: "ZAR",
        by: DEADLINE,
        settled: false,
        state: "open",
      },
    ]);
  });

  it("moves to due, then overdue, as log time passes the deadline (and stays unpaid)", async () => {
    const t = await town();
    const member = await t.admit(await phone());
    await openOrder(t, T0 + DAY_MS);
    await pledge(t, member, T0 + DAY_MS);

    await recordAt(t, DEADLINE + DAY_MS);
    const due = await obligationsOf(t.community.space.view, t.creator.did);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ kind: "pledge", settled: false, state: "due" });

    await recordAt(t, DEADLINE + OBLIGATION_GRACE_MS + DAY_MS);
    const overdue = await obligationsOf(t.community.space.view, t.creator.did);
    expect(overdue[0]).toMatchObject({ kind: "pledge", settled: false, state: "overdue" });
  });

  it("takes the latest pledge of a member, so a second pledge replaces the amount owed", async () => {
    const t = await town();
    const member = await t.admit(await phone());
    await openOrder(t, T0 + DAY_MS);
    await pledge(t, member, T0 + DAY_MS, 15000);
    await pledge(t, member, T0 + DAY_MS, 20000);
    const owed = await obligationsOf(t.community.space.view, t.creator.did);
    expect(owed).toHaveLength(1);
    expect(owed[0]).toMatchObject({ amountMinor: 20000 });
  });

  it("owes nothing for a pledge the record refused", async () => {
    const t = await town();
    const member = await t.admit(await phone());
    await openOrder(t, T0 + DAY_MS);
    const refused = await pledge(t, member, T0 + DAY_MS, 50);
    expect(refused).toBeDefined();
    expect(await obligationsOf(t.community.space.view, t.creator.did)).toEqual([]);
  });

  it("owes nothing before any event: an empty record has no obligations", async () => {
    const t = await town();
    expect(await obligationsOf(t.community.space.view, t.creator.did)).toEqual([]);
  });
});

describe("a delivered order owes its supplier", () => {
  it("is due on arrival, and paid once a payout to that supplier for that amount is on the record", async () => {
    const t = await town();
    const member = await t.admit(await phone());
    const driver = await t.admit(await phone());
    await openOrder(t, T0 + DAY_MS);
    await pledge(t, member, T0 + DAY_MS);
    const total = await chooseSupplierFor(t, T0 + DAY_MS);

    await grantDriver(t, driver, 7, T0 + DAY_MS);
    await plan(t, driver, T0 + DAY_MS);
    const arrival = T0 + 2 * DAY_MS;
    const confirmed = await driver.confirmDelivery(confirmation(), arrival);
    expect(confirmed.ok).toBe(true);
    await t.sync();

    const before = await obligationsOf(t.community.space.view, t.creator.did);
    const supplierOwed = before.find((o) => o.kind === "supplier");
    expect(supplierOwed).toEqual({
      id: expect.any(String),
      kind: "supplier",
      order: "o1",
      debtor: t.creator.did,
      creditor: SUPPLIER,
      amountMinor: total,
      currency: "ZAR",
      by: arrival,
      settled: false,
      state: "due",
    });

    const rejected = await rawRefusal(
      t.community.space,
      t.community.key,
      "payment.payout",
      {
        order: "o1",
        supplier: SUPPLIER,
        amount: { currency: "ZAR", minor: total },
        recommendation: "clear",
        bank: BANK,
      },
      arrival,
    );
    expect(rejected).toBeUndefined();

    const after = await obligationsOf(t.community.space.view, t.creator.did);
    expect(after.find((o) => o.kind === "supplier")).toMatchObject({
      settled: true,
      state: "settled",
    });
    // The pledge is still unpaid: no bank completion is applied to the view yet (S-10.1-3).
    expect(after.find((o) => o.kind === "pledge")).toMatchObject({ settled: false });
  });
});

describe("rebuilding from the same events", () => {
  it("gives the same obligations, each with its state, on every replica, and on every read", async () => {
    const t = await town();
    const member = await t.admit(await phone());
    const driver = await t.admit(await phone());
    await openOrder(t, T0 + DAY_MS);
    await pledge(t, member, T0 + DAY_MS);
    await chooseSupplierFor(t, T0 + DAY_MS);
    await grantDriver(t, driver, 7, T0 + DAY_MS);
    await plan(t, driver, T0 + DAY_MS);
    const confirmed = await driver.confirmDelivery(confirmation(), T0 + 2 * DAY_MS);
    expect(confirmed.ok).toBe(true);
    // Sync before the filler quotes below, so the arrival lands in the log before log time moves on past the
    // driver's role (otherwise the record refuses it as "Your role ended").
    await t.sync();
    await recordAt(t, DEADLINE + DAY_MS);
    await t.sync();

    const first = await obligationsOf(t.community.space.view, t.creator.did);
    const again = await obligationsOf(t.community.space.view, t.creator.did);
    expect(first.length).toBeGreaterThanOrEqual(2);
    expect(again).toEqual(first);

    for (const replica of t.members) {
      await replica.space.update();
      expect(await obligationsOf(replica.space.view, t.creator.did)).toEqual(first);
    }
    // The supplier's due day was the arrival, more than the grace period before log time now: overdue.
    expect(first.find((o) => o.kind === "supplier")).toMatchObject({ state: "overdue" });
    expect(first.find((o) => o.kind === "pledge")).toMatchObject({ state: "due" });
  });
});
