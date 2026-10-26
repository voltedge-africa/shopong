// Proof of delivery and of collection (story 7.6): who may confirm an arrival, a member's own share, and a dispute, all
// judged at log time as `apply` judges them. Simulated phones on one in-memory record, as delivery.test.ts does.
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
  logTimeOf,
  type Community,
  type CommunityDeps,
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

describe("confirming an arrival", () => {
  it("records the assigned driver's arrival, and the order shows it arrived", async () => {
    const t = await town();
    const driver = await t.admit(await phone());
    await grantDriver(t, driver, 7, T0 + DAY_MS);
    await plan(t, driver, T0 + DAY_MS);
    const confirmed = await driver.confirmDelivery(confirmation(), T0 + 2 * DAY_MS);
    expect(confirmed.ok).toBe(true);
    await t.sync();
    const progress = await t.community.orderProgress("o1");
    expect(progress.arrived).toBe(true);
    expect(progress.delivered).toMatchObject({
      photoSha512: PHOTO,
      driver: driver.me,
      lat: "-25.71",
      lng: "28.40",
    });
  });

  it("keeps no exact place: the coarse place is stored, and a finer one is refused with nothing stored", async () => {
    const t = await town();
    const driver = await t.admit(await phone());
    await grantDriver(t, driver, 7, T0 + DAY_MS);
    await plan(t, driver, T0 + DAY_MS);
    const refusal = await rawRefusal(
      driver.space,
      t.community.key,
      "delivery.confirmed",
      { order: "o1", photoSha512: PHOTO, lat: "-25.7079", lng: "28.4004" },
      T0 + 2 * DAY_MS,
    );
    expect(refusal).toBe("This delivery can't be read.");
    expect((await t.community.orderProgress("o1")).arrived).toBe(false);
  });

  it("refuses a driver who is not the one named on the plan", async () => {
    const t = await town();
    const named = await t.admit(await phone());
    const other = await t.admit(await phone());
    await grantDriver(t, named, 7, T0 + DAY_MS);
    await grantDriver(t, other, 7, T0 + DAY_MS);
    await plan(t, named, T0 + DAY_MS);
    const refused = await other.confirmDelivery(confirmation(), T0 + 2 * DAY_MS);
    expect(refused.ok).toBe(false);
    if (!refused.ok)
      expect(refused.error.message).toBe("Only the assigned driver can confirm this delivery.");
  });

  it("refuses a member who is not a driver", async () => {
    const t = await town();
    const driver = await t.admit(await phone());
    const joiner = await t.admit(await phone());
    await grantDriver(t, driver, 7, T0 + DAY_MS);
    await plan(t, driver, T0 + DAY_MS);
    const refused = await joiner.confirmDelivery(confirmation(), T0 + 2 * DAY_MS);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toBe("Only a driver can confirm a delivery.");
  });

  it("refuses a delivery nobody planned", async () => {
    const t = await town();
    const driver = await t.admit(await phone());
    await grantDriver(t, driver, 7, T0 + DAY_MS);
    const refused = await driver.confirmDelivery(confirmation(), T0 + 2 * DAY_MS);
    expect(refused.ok).toBe(false);
    if (!refused.ok)
      expect(refused.error.message).toBe("No delivery is planned for this order yet.");
  });

  it("refuses a second confirmation of the same delivery", async () => {
    const t = await town();
    const driver = await t.admit(await phone());
    await grantDriver(t, driver, 7, T0 + DAY_MS);
    await plan(t, driver, T0 + DAY_MS);
    expect((await driver.confirmDelivery(confirmation(), T0 + 2 * DAY_MS)).ok).toBe(true);
    await t.sync();
    const again = await driver.confirmDelivery(confirmation(), T0 + 3 * DAY_MS);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.message).toBe("Already confirmed.");
  });

  it("refuses a driver whose role ended, with the day it ended", async () => {
    const t = await town();
    const driver = await t.admit(await phone());
    await grantDriver(t, driver, 7, T0 + DAY_MS);
    await plan(t, driver, T0 + DAY_MS);
    const later = T0 + DAYS(9);
    await recordAt(t, later);
    const refused = await driver.confirmDelivery(confirmation(), later);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toMatch(/^Your role ended on /);
  });

  it("judges an offline arrival at log time, not the time the phone claimed", async () => {
    const t = await town();
    const driver = await t.admit(await phone());
    await grantDriver(t, driver, 7, T0 + DAY_MS);
    await plan(t, driver, T0 + DAY_MS);
    // The phone was offline on day 2 and sends the confirmation after the role has ended (day 9).
    const later = T0 + DAYS(9);
    await recordAt(t, later);
    const refusal = await rawRefusal(
      driver.space,
      t.community.key,
      "delivery.confirmed",
      { order: "o1", photoSha512: PHOTO, lat: "-25.71", lng: "28.40" },
      T0 + 2 * DAY_MS,
    );
    expect(refusal).toMatch(/^Your role ended on /);
    expect((await t.community.orderProgress("o1")).arrived).toBe(false);
  });
});

describe("confirming a member's collection", () => {
  it("lets each member confirm their own share, and the order shows N of N", async () => {
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
    expect(delivery).toMatch(/^[0-9a-f]{128}$/);

    expect((await ama.confirmCollection({ order: "o1", delivery }, T0 + 3 * DAY_MS)).ok).toBe(true);
    await t.sync();
    expect(await t.community.orderProgress("o1")).toMatchObject({ collected: 1, of: 2 });

    expect((await bongi.confirmCollection({ order: "o1", delivery }, T0 + 3 * DAY_MS)).ok).toBe(
      true,
    );
    await t.sync();
    expect(await t.community.orderProgress("o1")).toMatchObject({ collected: 2, of: 2 });
  });

  it("refuses a member confirming another member's share", async () => {
    const t = await town();
    const driver = await t.admit(await phone());
    const ama = await t.admit(await phone());
    const bongi = await t.admit(await phone());
    await grantDriver(t, driver, 7, T0 + DAY_MS);
    await plan(t, driver, T0 + DAY_MS);
    await pledge(t, ama, T0 + DAY_MS);
    await pledge(t, bongi, T0 + DAY_MS);
    await driver.confirmDelivery(confirmation(), T0 + 2 * DAY_MS);
    await t.sync();
    const delivery = (await t.community.orderProgress("o1")).delivered?.event as string;
    const refusal = await rawRefusal(
      bongi.space,
      t.community.key,
      "collection.confirmed",
      { order: "o1", delivery, member: ama.me },
      T0 + 3 * DAY_MS,
    );
    expect(refusal).toBe("Only a member can confirm their own collection.");
    expect((await t.community.orderProgress("o1")).collected).toBe(0);
  });

  it("refuses the treasurer confirming a collection for a member", async () => {
    const t = await town();
    const driver = await t.admit(await phone());
    const ama = await t.admit(await phone());
    await grantDriver(t, driver, 7, T0 + DAY_MS);
    await plan(t, driver, T0 + DAY_MS);
    await pledge(t, ama, T0 + DAY_MS);
    await driver.confirmDelivery(confirmation(), T0 + 2 * DAY_MS);
    await t.sync();
    const delivery = (await t.community.orderProgress("o1")).delivered?.event as string;
    const refusal = await rawRefusal(
      t.community.space,
      t.community.key,
      "collection.confirmed",
      { order: "o1", delivery, member: ama.me },
      T0 + 3 * DAY_MS,
    );
    expect(refusal).toBe("Only a member can confirm their own collection.");
  });

  it("refuses a collection before anything is delivered", async () => {
    const t = await town();
    const ama = await t.admit(await phone());
    await pledge(t, ama, T0 + DAY_MS);
    const refused = await ama.confirmCollection(
      { order: "o1", delivery: "a".repeat(128) },
      T0 + DAY_MS,
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toBe("This order has not been delivered yet.");
  });

  it("refuses a member with no share in the order", async () => {
    const t = await town();
    const driver = await t.admit(await phone());
    const ama = await t.admit(await phone());
    const nobody = await t.admit(await phone());
    await grantDriver(t, driver, 7, T0 + DAY_MS);
    await plan(t, driver, T0 + DAY_MS);
    await pledge(t, ama, T0 + DAY_MS);
    await driver.confirmDelivery(confirmation(), T0 + 2 * DAY_MS);
    await t.sync();
    const delivery = (await t.community.orderProgress("o1")).delivered?.event as string;
    const refused = await nobody.confirmCollection({ order: "o1", delivery }, T0 + 3 * DAY_MS);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toBe("You are not in this order.");
  });

  it("refuses a second collection by the same member", async () => {
    const t = await town();
    const driver = await t.admit(await phone());
    const ama = await t.admit(await phone());
    await grantDriver(t, driver, 7, T0 + DAY_MS);
    await plan(t, driver, T0 + DAY_MS);
    await pledge(t, ama, T0 + DAY_MS);
    await driver.confirmDelivery(confirmation(), T0 + 2 * DAY_MS);
    await t.sync();
    const delivery = (await t.community.orderProgress("o1")).delivered?.event as string;
    expect((await ama.confirmCollection({ order: "o1", delivery }, T0 + 3 * DAY_MS)).ok).toBe(true);
    await t.sync();
    const again = await ama.confirmCollection({ order: "o1", delivery }, T0 + 4 * DAY_MS);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.message).toBe("Already confirmed.");
  });
});

describe("disputing a delivery", () => {
  it("lets a member dispute a share beside the confirmation, which stays", async () => {
    const t = await town();
    const driver = await t.admit(await phone());
    const ama = await t.admit(await phone());
    await grantDriver(t, driver, 7, T0 + DAY_MS);
    await plan(t, driver, T0 + DAY_MS);
    await pledge(t, ama, T0 + DAY_MS);
    await driver.confirmDelivery(confirmation(), T0 + 2 * DAY_MS);
    await t.sync();
    const delivery = (await t.community.orderProgress("o1")).delivered?.event as string;
    const disputed = await ama.disputeDelivery(
      { order: "o1", delivery, note: "2 of 10 bags did not arrive" },
      T0 + 3 * DAY_MS,
    );
    expect(disputed.ok).toBe(true);
    await t.sync();
    const progress = await t.community.orderProgress("o1");
    expect(progress.arrived).toBe(true);
    expect(progress.disputes).toEqual([
      { by: ama.me, note: "2 of 10 bags did not arrive", event: expect.any(String) },
    ]);
  });

  it("lets the treasurer raise a dispute too", async () => {
    const t = await town();
    const driver = await t.admit(await phone());
    await grantDriver(t, driver, 7, T0 + DAY_MS);
    await plan(t, driver, T0 + DAY_MS);
    await driver.confirmDelivery(confirmation(), T0 + 2 * DAY_MS);
    await t.sync();
    const delivery = (await t.community.orderProgress("o1")).delivered?.event as string;
    const disputed = await t.community.disputeDelivery({ order: "o1", delivery }, T0 + 3 * DAY_MS);
    expect(disputed.ok).toBe(true);
  });

  it("refuses a dispute that names a delivery which is not this order's", async () => {
    const t = await town();
    const driver = await t.admit(await phone());
    const ama = await t.admit(await phone());
    await grantDriver(t, driver, 7, T0 + DAY_MS);
    await plan(t, driver, T0 + DAY_MS);
    await pledge(t, ama, T0 + DAY_MS);
    await driver.confirmDelivery(confirmation(), T0 + 2 * DAY_MS);
    await t.sync();
    const refused = await ama.disputeDelivery(
      { order: "o1", delivery: "a".repeat(128) },
      T0 + 3 * DAY_MS,
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toBe("That is not this order's delivery.");
  });
});

describe("the order's progress", () => {
  it("shows nothing arrived, nothing collected, and the members who have a share", async () => {
    const t = await town();
    const driver = await t.admit(await phone());
    const ama = await t.admit(await phone());
    await grantDriver(t, driver, 7, T0 + DAY_MS);
    await plan(t, driver, T0 + DAY_MS);
    await pledge(t, ama, T0 + DAY_MS);
    expect(await t.community.orderProgress("o1")).toMatchObject({
      arrived: false,
      plannedDriver: driver.me,
      collected: 0,
      of: 1,
      disputes: [],
    });
    expect((await t.community.orderProgress("o1")).shares).toEqual([
      { member: ama.me, collected: false },
    ]);
  });
});
