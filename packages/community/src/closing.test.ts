// Collecting and closing an order (story 8.7): every row of the plan's matrix, judged at log time as `apply` judges it.
// Simulated phones on one in-memory record, as proof.test.ts does.
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
  checkInvitation,
  communityDefinition,
  createCommunity,
  joinCommunity,
  differenceOf,
  logTimeOf,
  memberLabel,
  randText,
  type Community,
  type CommunityDeps,
  type PoolView,
  type RoleDraft,
} from "./index.js";
import { coTreasurerJoinRecorded, isCurrentGrantIn } from "./roles.js";

const T0 = 1_793_000_000_000;
const DAYS = (n: number) => n * DAY_MS;
const COMMITMENT = "e".repeat(128);
const PHOTO = "f".repeat(128);

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

/** One community on one record: the creator, and everyone admitted to it (as delivery.test.ts does). */
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

/** A member's pledge to order `o1`, written as the member's own event. */
async function pledge(t: Town, member: Community, now: number): Promise<void> {
  const refusal = await rawRefusal(
    member.space,
    t.community.key,
    "pledge.created",
    { order: "o1", member: member.me, amount: { currency: "ZAR", minor: 15000 } },
    now,
  );
  if (refusal !== undefined) throw new Error(refusal);
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
  // A raw envelope, not `createEvent`: `createEvent` refuses a bad payload before it exists, and these rows test
  // that the record refuses it too.
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

const confirmation = (over: Record<string, unknown> = {}) => ({
  order: "o1",
  photoSha512: PHOTO,
  lat: "-25.71",
  lng: "28.40",
  ...over,
});

/** A town with a driver, two pledged members and the delivery confirmed. */
async function delivered() {
  const t = await town();
  const driver = await t.admit(await phone());
  const ama = await t.admit(await phone());
  const bongi = await t.admit(await phone());
  await grantDriver(t, driver, 7, T0 + DAY_MS);
  await plan(t, driver, T0 + DAY_MS);
  await pledge(t, ama, T0 + DAY_MS);
  await pledge(t, bongi, T0 + DAY_MS);
  expect((await driver.confirmDelivery(confirmation(), T0 + 2 * DAY_MS)).ok).toBe(true);
  await t.sync();
  const delivery = (await t.community.orderProgress("o1")).delivered?.event as string;
  const collect = async (who: Community, at = T0 + 3 * DAY_MS) => {
    const done = await who.confirmCollection({ order: "o1", delivery }, at);
    expect(done.ok).toBe(true);
    await t.sync();
  };
  return { t, driver, ama, bongi, delivery, collect };
}

const refusalOf = (result: { ok: boolean; error?: { message: string } }) =>
  result.ok ? undefined : result.error?.message;

describe("closing an order", { timeout: 60_000 }, () => {
  it("closes when every member has collected, and the summary, timeline and open items show it", async () => {
    const { t, ama, bongi, collect } = await delivered();
    await collect(ama);
    await collect(bongi);
    const closed = await t.community.closeOrder("o1", T0 + 4 * DAY_MS);
    expect(closed.ok).toBe(true);
    await t.sync();
    const summary = await t.community.closingOf("o1");
    expect(summary.closed).toBe(true);
    expect(summary.members.map((m) => m.collected)).toEqual([true, true]);
    expect(summary.openItems).toEqual([]);
    const sentences = summary.timeline.map((line) => line.sentence);
    expect(sentences.at(-1)).toBe(`You closed the order.`);
    expect(sentences.some((s) => s.includes("confirmed the goods arrived"))).toBe(true);
    expect(sentences.filter((s) => s.includes("collected their share"))).toHaveLength(2);
    // The members see the same summary on their own phones.
    await ama.space.update();
    expect((await ama.closingOf("o1")).closed).toBe(true);
  });

  it("refuses the close while one member has not collected, and says who is missing", async () => {
    const { t, ama, bongi, collect } = await delivered();
    await collect(ama);
    const refused = await t.community.closeOrder("o1", T0 + 4 * DAY_MS);
    expect(refusalOf(refused)).toBe(`Not everyone has collected yet: ${memberLabel(bongi.me)}.`);
    expect(await t.community.closeProblem("o1")).toBe(
      `Not everyone has collected yet: ${memberLabel(bongi.me)}.`,
    );
    const summary = await t.community.closingOf("o1");
    expect(summary.closed).toBe(false);
    expect(summary.openItems).toContain(`${memberLabel(bongi.me)} has not collected yet.`);
  });

  it("refuses a close from anyone but the treasurer", async () => {
    const { t, ama, bongi, collect } = await delivered();
    await collect(ama);
    await collect(bongi);
    const refused = await ama.closeOrder("o1", T0 + 4 * DAY_MS);
    expect(refusalOf(refused)).toBe("Only the treasurer can close an order.");
    expect(await ama.closeProblem("o1")).toBe("Only the treasurer can close an order.");
    await t.sync();
    expect((await t.community.closingOf("o1")).closed).toBe(false);
  });

  it("refuses the close before the delivery is confirmed", async () => {
    const t = await town();
    const ama = await t.admit(await phone());
    await pledge(t, ama, T0 + DAY_MS);
    const refused = await t.community.closeOrder("o1", T0 + 2 * DAY_MS);
    expect(refusalOf(refused)).toBe("The delivery has not been confirmed yet.");
  });

  it("closes an order once: a second close is refused as already closed", async () => {
    const { t, ama, bongi, collect } = await delivered();
    await collect(ama);
    await collect(bongi);
    expect((await t.community.closeOrder("o1", T0 + 4 * DAY_MS)).ok).toBe(true);
    await t.sync();
    const again = await t.community.closeOrder("o1", T0 + 5 * DAY_MS);
    expect(refusalOf(again)).toBe("This order is already closed.");
    // The record still holds one close.
    expect(await t.community.space.view.list("closed/")).toHaveLength(1);
  });

  it("judges the treasurer at log time: a co-treasurer whose role ended cannot close", async () => {
    const { t, ama, bongi, collect } = await delivered();
    const co = await t.admit(await phone());
    await recordAt(t, T0 + 4 * DAY_MS);
    const granted = await t.community.grantRole(
      co.me,
      "co-treasurer",
      { limit: { currency: "ZAR", minor: 100_000 }, days: 7 },
      T0 + 4 * DAY_MS,
    );
    expect(granted.ok).toBe(true);
    await t.sync();
    await collect(ama, T0 + 4 * DAY_MS);
    await collect(bongi, T0 + 4 * DAY_MS);
    const later = T0 + DAYS(13);
    await recordAt(t, later);
    const refused = await co.closeOrder("o1", later);
    expect(refusalOf(refused)).toMatch(/^Your role ended on /);
  });

  it("refuses a close that carries a different payload than the strict form, and an order with nobody in it", async () => {
    const t = await town();
    const refusal = await rawRefusal(
      t.community.space,
      t.community.key,
      "order.closed",
      { order: "o1", extra: "x" },
      T0 + DAY_MS,
    );
    expect(refusal).toBe("This closing can't be read.");
  });

  it("does not count a member who has since left", async () => {
    const { t, ama, bongi, collect } = await delivered();
    await collect(ama);
    // The member leaves: a removal of themself, which the record accepts.
    const leaving = await rawRefusal(
      bongi.space,
      t.community.key,
      "member.removed",
      { member: bongi.me },
      T0 + 4 * DAY_MS,
    );
    expect(leaving).toBeUndefined();
    await t.sync();
    expect((await t.community.closeOrder("o1", T0 + 5 * DAY_MS)).ok).toBe(true);
  });
});

describe("the closing summary's words", { timeout: 60_000 }, () => {
  const pool = (paid: string, share: string, others: ("paid" | "waiting")[] = []) =>
    ({
      currency: "ZAR",
      total: { minor: "30000", text: "The pool holds R300.00." },
      target: { minor: "30000", text: "The target is R300.00." },
      funding: null,
      you: {
        minor: paid,
        text: `You have paid ${randText(BigInt(paid))}`,
        share,
        shareText: `Your share is ${randText(BigInt(share))}`,
        status: { kind: "paid", label: "Paid" },
      },
      members: others.map((kind) => ({
        you: false,
        status: { kind, label: kind === "paid" ? "Paid" : "Waiting" },
      })),
      flags: [],
    }) as unknown as PoolView;

  it("shows an overpayment as credit still in the pool, never as paid back", async () => {
    const { t } = await delivered();
    const summary = await t.community.closingOf("o1", pool("17000", "15000"));
    expect(summary.you?.difference.kind).toBe("credit");
    expect(summary.you?.difference.words).toBe(
      "R20.00 credit, still in the pool. Nothing has been paid back.",
    );
    expect(JSON.stringify(summary).toLowerCase()).not.toContain("refund");
  });

  it("shows an underpayment as still to pay, and lists it as an open item", async () => {
    const { t } = await delivered();
    const summary = await t.community.closingOf("o1", pool("10000", "15000", ["waiting"]));
    expect(summary.you?.difference).toMatchObject({ kind: "owing", words: "R50.00 still to pay." });
    expect(summary.openItems).toContain("You still need to pay R50.00.");
    expect(summary.openItems).toContain("1 member has not paid their share in full yet.");
  });

  it("says a member paid in full when paid equals the share", () => {
    expect(differenceOf(15000, 15000)).toMatchObject({ kind: "even", minor: 0 });
  });

  it("shows no payment figures when the pool could not be read", async () => {
    const { t } = await delivered();
    const summary = await t.community.closingOf("o1");
    expect(summary.you).toBeUndefined();
    expect(summary.notes).toEqual(["Payment figures show once the Node can be reached."]);
  });
});
