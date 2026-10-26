// Route planning in the record (story 7.4): who may plan at log time, the shape of `delivery.planned`, and place ids
// instead of coordinates. Simulated phones on one in-memory record, as roles.test.ts does.
import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import { createMemoryRecordNetwork, type MemoryRecordNetwork } from "@shopong/adapters-memory";
import {
  ENVELOPE_VERSION,
  routeFingerprint,
  webCryptoSha512,
  type EventEnvelope,
  type JsonObject,
} from "@shopong/events";
import type { Did, Space } from "@shopong/ports";
import { describe, expect, it } from "vite-plus/test";
import {
  DAY_MS,
  DELIVERY_MESSAGES,
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
import { isTreasurer } from "./quotes.js";

const T0 = 1_793_000_000_000;
const DAYS = (n: number) => n * DAY_MS;
const COMMITMENT = "e".repeat(128);

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

/** One community on one record: the creator, and everyone admitted to it (as roles.test.ts). */
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

async function routeFor(origin: string, destination: string) {
  const polyline6 = "_p~iF~ps|U_ulLnnqC";
  const fingerprint = await routeFingerprint(polyline6, "straight-line", webCryptoSha512);
  return {
    order: "o1",
    origin,
    destination,
    route: {
      costing: "auto",
      distanceMeters: 12_400,
      durationSeconds: 1_500,
      tileRelease: "straight-line",
      fingerprint,
    },
  };
}

/** Writes a raw event as `who` (any payload) and returns the view's refusal for it, or undefined when accepted. */
async function rawRefusal(
  space: Space<EventEnvelope>,
  key: string,
  type: string,
  payload: JsonObject,
  at: number,
): Promise<string | undefined> {
  // A raw envelope, not `createEvent`: `createEvent` refuses a bad payload before it exists, and these rows test
  // that the record refuses it too (the Node's sync route checks the same shape before it appends).
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

describe("registering a place", () => {
  it("accepts the treasurer's place and keeps only its id, label, area and commitment", async () => {
    const t = await town();
    const depot = place("a");
    const added = await t.community.registerPlace(depot, T0);
    expect(added.ok).toBe(true);
    await t.community.space.update();
    expect(await t.community.space.view.get(`places/${depot.id}`)).toEqual({
      label: depot.label,
      area: depot.area,
      addressCommitment: COMMITMENT,
    });
  });

  it("refuses a plain member's place with the plain sentence", async () => {
    const t = await town();
    const joiner = await t.admit(await phone());
    const refusal = await rawRefusal(
      joiner.space,
      t.community.key,
      "place.registered",
      { place: "a".repeat(64), label: "Depot", area: "Soweto", addressCommitment: COMMITMENT },
      T0 + DAY_MS,
    );
    expect(refusal).toBe(DELIVERY_MESSAGES.place_not_permitted);
  });

  it("refuses a place that carries coordinates, so none reaches the record", async () => {
    const t = await town();
    const refusal = await rawRefusal(
      t.community.space,
      t.community.key,
      "place.registered",
      {
        place: "a".repeat(64),
        label: "Depot",
        area: "Soweto",
        addressCommitment: COMMITMENT,
        lat: -25.7079,
        lng: 28.4004,
      },
      T0,
    );
    expect(refusal).toBe(DELIVERY_MESSAGES.place_unreadable);
  });
});

describe("planning a route", () => {
  it("lets the treasurer plan between two registered places, and records the fingerprint", async () => {
    const t = await town();
    await t.community.registerPlace(place("a"), T0);
    await t.community.registerPlace(place("b"), T0);
    const driver = await t.admit(await phone());
    await grantDriver(t, driver, 7, T0 + DAY_MS);
    const draft = await routeFor("a".repeat(64), "b".repeat(64));
    const planned = await t.community.planDelivery(
      { ...draft, driver: driver.me, windowStart: T0, windowEnd: T0 + 7_200_000 },
      T0 + DAY_MS,
    );
    expect(planned.ok).toBe(true);
    await t.community.space.update();
    const stored = (await t.community.space.view.get("delivery/o1")) as JsonObject;
    expect(stored.fingerprint).toBe(draft.route.fingerprint);
    expect(stored.origin).toBe("a".repeat(64));
    expect(JSON.stringify(stored)).not.toMatch(/lat|lng|polyline/);
  });

  it("lets a current driver plan", async () => {
    const t = await town();
    await t.community.registerPlace(place("a"), T0);
    await t.community.registerPlace(place("b"), T0);
    const driver = await t.admit(await phone());
    await grantDriver(t, driver, 7, T0 + DAY_MS);
    const draft = await routeFor("a".repeat(64), "b".repeat(64));
    const planned = await driver.planDelivery({ ...draft, driver: driver.me }, T0 + 2 * DAY_MS);
    expect(planned.ok).toBe(true);
    await t.sync();
    expect(await t.community.space.view.get("delivery/o1")).toBeDefined();
  });

  it("refuses a plain member's plan with the plain sentence", async () => {
    const t = await town();
    await t.community.registerPlace(place("a"), T0);
    await t.community.registerPlace(place("b"), T0);
    const joiner = await t.admit(await phone());
    const draft = await routeFor("a".repeat(64), "b".repeat(64));
    const refusal = await rawRefusal(
      joiner.space,
      t.community.key,
      "delivery.planned",
      { ...draft, driver: joiner.me, route: draft.route },
      T0 + DAY_MS,
    );
    expect(refusal).toBe(DELIVERY_MESSAGES.not_permitted);
  });

  it("refuses a plan by a driver whose role has ended, at log time", async () => {
    const t = await town();
    await t.community.registerPlace(place("a"), T0);
    await t.community.registerPlace(place("b"), T0);
    const driver = await t.admit(await phone());
    await grantDriver(t, driver, 7, T0 + DAY_MS);
    // Nine days on, the seven-day driver role has ended. The record judges the event at its log time.
    const later = T0 + DAYS(9);
    await recordAt(t, later);
    const draft = await routeFor("a".repeat(64), "b".repeat(64));
    const refusal = await rawRefusal(
      driver.space,
      t.community.key,
      "delivery.planned",
      {
        ...draft,
        driver: driver.me,
      },
      later,
    );
    expect(refusal).toBeDefined();
    expect(refusal).not.toBe(DELIVERY_MESSAGES.not_permitted);
    await t.community.space.update();
    expect(await t.community.space.view.get("delivery/o1")).toBeUndefined();
  });

  it("refuses a route to a place that is not registered", async () => {
    const t = await town();
    await t.community.registerPlace(place("a"), T0);
    const draft = await routeFor("a".repeat(64), "c".repeat(64));
    const refusal = await rawRefusal(
      t.community.space,
      t.community.key,
      "delivery.planned",
      { ...draft, driver: t.creator.did as Did },
      T0 + DAY_MS,
    );
    expect(refusal).toBe(DELIVERY_MESSAGES.unknown_place);
  });

  it("refuses a route with coordinates in it, so none reaches the record", async () => {
    const t = await town();
    await t.community.registerPlace(place("a"), T0);
    await t.community.registerPlace(place("b"), T0);
    const draft = await routeFor("a".repeat(64), "b".repeat(64));
    const refusal = await rawRefusal(
      t.community.space,
      t.community.key,
      "delivery.planned",
      {
        ...draft,
        driver: t.creator.did as Did,
        route: { ...draft.route, polyline6: "_p~iF~ps|U" },
      },
      T0 + DAY_MS,
    );
    expect(refusal).toBe(DELIVERY_MESSAGES.unreadable);
  });

  it("refuses a route from a place to itself", async () => {
    const t = await town();
    await t.community.registerPlace(place("a"), T0);
    const draft = await routeFor("a".repeat(64), "a".repeat(64));
    const refusal = await rawRefusal(
      t.community.space,
      t.community.key,
      "delivery.planned",
      { ...draft, driver: t.creator.did as Did },
      T0 + DAY_MS,
    );
    expect(refusal).toBe(DELIVERY_MESSAGES.same_place);
  });

  it("knows the treasurer is the creator (the standing used for planning)", async () => {
    const t = await town();
    const standing = { auth: t.creator.auth, creator: t.creator.did, spaceKey: t.community.key };
    await t.community.space.update();
    expect(await isTreasurer(standing, t.community.space.view, t.creator.did, T0)).toBe(true);
  });
});

describe("patch: confirmations and the driver's standing", () => {
  it("refuses a delivery confirmation that carries a coordinate", async () => {
    const t = await town();
    await t.community.registerPlace(place("a"), T0);
    const driver = await t.admit(await phone());
    await grantDriver(t, driver, 7, T0 + DAY_MS);
    const refusal = await rawRefusal(
      driver.space,
      t.community.key,
      "delivery.confirmed",
      {
        order: "o1",
        photoSha512: "f".repeat(128),
        latMicro: -25_707_900,
        lngMicro: 28_400_400,
      },
      T0 + DAY_MS,
    );
    expect(refusal).toBe("This delivery can't be read.");
  });

  it("refuses a planned route whose named driver holds no driver role", async () => {
    const t = await town();
    await t.community.registerPlace(place("a"), T0);
    await t.community.registerPlace(place("b"), T0);
    const notDriver = await t.admit(await phone());
    const draft = await routeFor("a".repeat(64), "b".repeat(64));
    const refusal = await rawRefusal(
      t.community.space,
      t.community.key,
      "delivery.planned",
      {
        ...draft,
        driver: notDriver.me,
      },
      T0 + DAY_MS,
    );
    expect(refusal).toBe("That person is not a driver of this community at this time.");
  });
});

describe("patch: the current driver is judged as the record judges a driver", () => {
  it("names the driver whose role stands, and nobody once it has ended", async () => {
    const t = await town();
    const driver = await t.admit(await phone());
    await grantDriver(t, driver, 7, T0 + DAY_MS);
    expect(await t.community.currentDriver(T0 + 2 * DAY_MS)).toBe(driver.me);
    await recordAt(t, T0 + DAYS(9));
    expect(await t.community.currentDriver(T0 + DAYS(9))).toBeUndefined();
  });
});
