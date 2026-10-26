// The Node's route planning (story 7.4), over real HTTP and a real record in a temp folder: place registration, the
// signed plan, the member-only read of a route, and the record's refusal of a route that names no place. The
// security rows (a plain member, an unknown place, a replayed request, another community's member, coordinates in
// an event) are first in each group so a failure is easy to read.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vite-plus/test";
import {
  encodeProof,
  issueInvitation,
  newCommunityKey,
  signRequest,
  type RequestParts,
} from "@shopong/community";
import {
  ENVELOPE_VERSION,
  createEvent,
  eventIdOf,
  webCryptoSha512,
  type EventEnvelope,
} from "@shopong/events";
import type { ViewReader } from "@shopong/ports";
import { startNode, type RunningNode } from "./node.ts";
import { PlaceRegistry, RouteStore } from "./places.ts";
import { ROUTE_MESSAGES, nonceRefusalMessage } from "./route-routes.ts";
import { nodeHmacSha512 } from "./commitments.ts";
import { commitPhoneNumber, commitAddress } from "@shopong/events";
import { issueRole, logTimeOf } from "@shopong/community";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { captureSink, FAKE_SECRETS } from "./testing/capture.ts";
import { phone, randomHex, type Phone } from "./testing/community.ts";

const folders: string[] = [];
const freshFolder = (): string => {
  const folder = mkdtempSync(join(tmpdir(), "ocn-node-route-"));
  folders.push(folder);
  return folder;
};
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

let running: RunningNode | undefined;
let logs: ReturnType<typeof captureSink> | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

const SECRET = randomHex(32);
const DEPOT = { label: "Mamelodi Wholesale depot", area: "Mamelodi", lat: -25.7079, lng: 28.4004 };
const HALL = { label: "Orlando community hall", area: "Soweto", lat: -26.2395, lng: 27.9094 };
const NAIROBI = { label: "Nairobi yard", area: "Nairobi", lat: -1.2921, lng: 36.8219 };
const ADDRESS = "12 Church Street, Mamelodi";

async function start(): Promise<RunningNode> {
  logs = captureSink();
  running = await startNode({
    env: {
      OCN_NODE_PORT: "0",
      OCN_NODE_DATA_DIR: freshFolder(),
      RECORD_MASTER_KEY: FAKE_SECRETS.RECORD_MASTER_KEY,
      COMMUNITY_SECRET: SECRET,
    },
    sink: logs,
  });
  return running;
}

type Reply = { status: number; json: Record<string, unknown> };

/** A signed request. `replay` sends an already-built signature again (the same one-time number). */
async function call(
  node: RunningNode,
  signer: Phone | undefined,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  replay?: Record<string, string>,
): Promise<{ reply: Reply; headers: Record<string, string> }> {
  const text = body === undefined ? "" : JSON.stringify(body);
  let headers: Record<string, string> = replay ?? {};
  if (signer !== undefined && replay === undefined) {
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
  return {
    reply: { status: res.status, json: (await res.json()) as Record<string, unknown> },
    headers,
  };
}

const randomKey = (): string => newCommunityKey((n) => crypto.getRandomValues(new Uint8Array(n)));

async function eventOf(
  key: string,
  who: Phone,
  type: string,
  payload: object,
  proof: string[] = [],
) {
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

/** A raw envelope, for a payload `createEvent` refuses (a float): the Node's sync route must refuse it too. */
function rawEnvelope(key: string, who: Phone, type: string, payload: object): EventEnvelope {
  return {
    v: ENVELOPE_VERSION,
    type,
    space: key,
    actor: who.did,
    proof: [],
    claimedAt: Date.now(),
    nonce: randomHex(16),
    payload,
  } as unknown as EventEnvelope;
}

async function post(node: RunningNode, who: Phone, key: string, event: unknown): Promise<Reply> {
  let last: Reply = { status: 0, json: {} };
  for (let i = 0; i < 100; i++) {
    last = (await call(node, who, "POST", `/spaces/${key}/events`, event)).reply;
    if (last.status !== 403 || last.json.problem !== "not_writable") return last;
    await new Promise((r) => setTimeout(r, 50));
  }
  return last;
}

/** The creator invites a person who joins: the plain member of this community. */
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
  const joined = await call(node, joiner, "POST", `/communities/${key}/members`, {
    invitation: issued.value.link,
  });
  expect(joined.reply.status).toBe(200);
  const event = await eventOf(key, joiner, "member.joined", { invitation: issued.value.id }, [
    encodeProof(issued.value.token),
  ]);
  expect((await post(node, joiner, key, event)).status).toBe(200);
  return joiner;
}

/** A community made by `creator` (the founder), with one plain member admitted. */
async function community(node: RunningNode) {
  const creator = await phone();
  const key = randomKey();
  expect((await call(node, creator, "POST", "/communities", { key })).reply.status).toBe(200);
  const founder = await eventOf(key, creator, "member.joined", { invitation: "founder" });
  expect((await post(node, creator, key, founder)).status).toBe(200);
  const member = await admit(node, creator, key);
  return { creator, member, key };
}

/** The Node registers a place; the treasurer's phone then records its id, label, area and commitment (as the app does). */
async function registerPlace(node: RunningNode, who: Phone, key: string, place: typeof DEPOT) {
  const made = await call(node, who, "POST", `/communities/${key}/places`, {
    request: randomHex(16),
    label: place.label,
    area: place.area,
    lat: place.lat,
    lng: place.lng,
    address: ADDRESS,
  });
  if (made.reply.status === 200) {
    const recorded = await post(
      node,
      who,
      key,
      await eventOf(key, who, "place.registered", {
        place: made.reply.json.id,
        label: made.reply.json.label,
        area: made.reply.json.area,
        addressCommitment: made.reply.json.addressCommitment,
      }),
    );
    expect(recorded.status, JSON.stringify(recorded.json)).toBe(200);
  }
  return made;
}

async function viewOf(node: RunningNode, key: string): Promise<ViewReader> {
  const view = await node.hub?.indexedView(key);
  if (view === undefined) throw new Error("no view");
  return view;
}

/** Waits for the record's view to hold `check`, since the indexer applies an append a moment later. */
async function eventually<T>(read: () => Promise<T | undefined>): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("the record did not show it");
}

const COORDINATE_DIGITS = ["-25.7079", "28.4004", "-26.2395", "27.9094", "12 Church"];

describe("placing and planning a route: security", () => {
  it("refuses a plain member's place, and a place the Node cannot route, with plain sentences", async () => {
    const node = await start();
    const { creator, member, key } = await community(node);
    const refused = await registerPlace(node, member, key, DEPOT);
    expect(refused.reply.status).toBe(403);
    expect(refused.reply.json.reason).toBe("Only the treasurer can add a place.");
    const abroad = await registerPlace(node, creator, key, NAIROBI);
    expect(abroad.reply.status).toBe(200);
    const home = await registerPlace(node, creator, key, DEPOT);
    const plan = await call(node, creator, "POST", `/communities/${key}/routes`, {
      order: "o1",
      origin: home.reply.json.id,
      destination: abroad.reply.json.id,
    });
    expect(plan.reply.status).toBe(422);
    expect(plan.reply.json.reason).toBe("That place is outside the area this Node can route.");
  });

  it("refuses a plain member's plan with the plain sentence", async () => {
    const node = await start();
    const { creator, member, key } = await community(node);
    const a = await registerPlace(node, creator, key, DEPOT);
    const b = await registerPlace(node, creator, key, HALL);
    const plan = await call(node, member, "POST", `/communities/${key}/routes`, {
      order: "o1",
      origin: a.reply.json.id,
      destination: b.reply.json.id,
    });
    expect(plan.reply.status).toBe(403);
    expect(plan.reply.json.reason).toBe("Only the treasurer or the driver can plan a route.");
  });

  it("refuses a route for a place that is not registered", async () => {
    const node = await start();
    const { creator, key } = await community(node);
    const a = await registerPlace(node, creator, key, DEPOT);
    const plan = await call(node, creator, "POST", `/communities/${key}/routes`, {
      order: "o1",
      origin: a.reply.json.id,
      destination: "f".repeat(64),
    });
    expect(plan.reply.status).toBe(422);
    expect(plan.reply.json.reason).toBe("That place is not registered with this community.");
  });

  it("refuses a replayed plan: the same signed request twice", async () => {
    const node = await start();
    const { creator, key } = await community(node);
    const a = await registerPlace(node, creator, key, DEPOT);
    const b = await registerPlace(node, creator, key, HALL);
    const body = { order: "o1", origin: a.reply.json.id, destination: b.reply.json.id };
    const first = await call(node, creator, "POST", `/communities/${key}/routes`, body);
    expect(first.reply.status).toBe(200);
    const again = await call(
      node,
      undefined,
      "POST",
      `/communities/${key}/routes`,
      body,
      first.headers,
    );
    expect(again.reply.status).toBe(409);
    expect(again.reply.json.reason).toBe("That request was already used.");
  });

  it("refuses a member of another community reading a route", async () => {
    const node = await start();
    const first = await community(node);
    const second = await community(node);
    const a = await registerPlace(node, first.creator, first.key, DEPOT);
    const b = await registerPlace(node, first.creator, first.key, HALL);
    const plan = await call(node, first.creator, "POST", `/communities/${first.key}/routes`, {
      order: "o1",
      origin: a.reply.json.id,
      destination: b.reply.json.id,
    });
    const fingerprint = plan.reply.json.fingerprint as string;
    const read = await call(
      node,
      second.member,
      "GET",
      `/communities/${second.key}/route?order=o1&fingerprint=${fingerprint}`,
    );
    expect(read.reply.status).not.toBe(200);
    expect(read.reply.json.polyline6).toBeUndefined();
  });

  it("refuses a place or a route with a coordinate or an address in the record", async () => {
    const node = await start();
    const { creator, key } = await community(node);
    const withCoordinates = await post(
      node,
      creator,
      key,
      rawEnvelope(key, creator, "place.registered", {
        place: "a".repeat(64),
        label: "Depot",
        area: "Mamelodi",
        addressCommitment: "e".repeat(128),
        lat: DEPOT.lat,
        lng: DEPOT.lng,
      }),
    );
    expect(withCoordinates.status).toBe(400);
    expect(withCoordinates.json.problem).toBe("invalid_event");
    const withLine = await post(
      node,
      creator,
      key,
      rawEnvelope(key, creator, "delivery.planned", {
        order: "o1",
        driver: creator.did,
        origin: "a".repeat(64),
        destination: "b".repeat(64),
        route: {
          costing: "auto",
          distanceMeters: 1,
          durationSeconds: 1,
          tileRelease: "straight-line",
          fingerprint: "c".repeat(128),
          polyline6: "_p~iF~ps|U",
        },
      }),
    );
    expect(withLine.status).toBe(400);
    expect(withLine.json.problem).toBe("invalid_event");
  });
});

describe("placing and planning a route: the path", () => {
  it("a treasurer registers two places and plans the route: summary, line and three sentences", async () => {
    const node = await start();
    const { creator, member, key } = await community(node);
    const a = await registerPlace(node, creator, key, DEPOT);
    const b = await registerPlace(node, creator, key, HALL);
    expect(a.reply.status).toBe(200);
    expect(a.reply.json.id).toMatch(/^[0-9a-f]{64}$/);
    expect(a.reply.json.addressCommitment).toMatch(/^[0-9a-f]{128}$/);
    expect(JSON.stringify(a.reply.json)).not.toContain(ADDRESS);

    const plan = await call(node, creator, "POST", `/communities/${key}/routes`, {
      order: "o1",
      origin: a.reply.json.id,
      destination: b.reply.json.id,
    });
    expect(plan.reply.status).toBe(200);
    expect(plan.reply.json.fingerprint).toMatch(/^[0-9a-f]{128}$/);
    expect(plan.reply.json.straightLine).toBe(true);
    expect(plan.reply.json.polyline6).toMatch(/\S/);
    expect(plan.reply.json.sentences).toHaveLength(3);
    expect((plan.reply.json.sentences as string[])[0]).toBe(
      `Route from ${DEPOT.label} to ${HALL.label}.`,
    );
    expect((plan.reply.json.sentences as string[])[2]).toBe(
      "This is a straight-line estimate, not a road route.",
    );

    // Every member reads the same route, by the fingerprint, and sees the same line.
    const read = await call(
      node,
      member,
      "GET",
      `/communities/${key}/route?order=o1&fingerprint=${plan.reply.json.fingerprint as string}`,
    );
    expect(read.reply.status).toBe(200);
    expect(read.reply.json.polyline6).toBe(plan.reply.json.polyline6);
    expect(read.reply.json.sentences).toEqual(plan.reply.json.sentences);
  });

  it("the record holds the planned route by its ids and fingerprint, and refuses an unknown place", async () => {
    const node = await start();
    const { creator, member: driverPhone, key } = await community(node);
    await grantRoleOn(node, creator, key, driverPhone, "driver");
    const a = await registerPlace(node, creator, key, DEPOT);
    const b = await registerPlace(node, creator, key, HALL);
    const plan = await call(node, creator, "POST", `/communities/${key}/routes`, {
      order: "o1",
      origin: a.reply.json.id,
      destination: b.reply.json.id,
    });
    const fingerprint = plan.reply.json.fingerprint as string;
    const planned = await eventOf(key, creator, "delivery.planned", {
      order: "o1",
      driver: driverPhone.did,
      origin: a.reply.json.id,
      destination: b.reply.json.id,
      route: {
        costing: "auto",
        distanceMeters: plan.reply.json.distanceMeters,
        durationSeconds: plan.reply.json.durationSeconds,
        tileRelease: plan.reply.json.tileRelease,
        fingerprint,
      },
    });
    expect((await post(node, creator, key, planned)).status).toBe(200);
    const stored = await eventually(async () => {
      const view = await viewOf(node, key);
      return (await view.get("delivery/o1")) as { fingerprint?: string } | undefined;
    });
    expect(stored.fingerprint).toBe(fingerprint);

    const stranger = await eventOf(key, creator, "delivery.planned", {
      order: "o2",
      driver: driverPhone.did,
      origin: a.reply.json.id,
      destination: "d".repeat(64),
      route: {
        costing: "auto",
        distanceMeters: 1,
        durationSeconds: 1,
        tileRelease: "straight-line",
        fingerprint,
      },
    });
    expect((await post(node, creator, key, stranger)).status).toBe(200);
    const strangerId = await eventIdOf(stranger, webCryptoSha512);
    const rejected = await eventually(async () => {
      const view = await viewOf(node, key);
      return (await view.get(`rejected/${strangerId}`)) as { reason?: string } | undefined;
    });
    expect(rejected.reason).toBe("That place is not registered with this community.");
  });

  it("writes no coordinate or address to the log", async () => {
    const node = await start();
    const { creator, key } = await community(node);
    const a = await registerPlace(node, creator, key, DEPOT);
    const b = await registerPlace(node, creator, key, HALL);
    await call(node, creator, "POST", `/communities/${key}/routes`, {
      order: "o1",
      origin: a.reply.json.id,
      destination: b.reply.json.id,
    });
    const text = logs?.text() ?? "";
    for (const digits of COORDINATE_DIGITS) expect(text).not.toContain(digits);
  });
});

// Patch of story 7.4 (review): removed people cannot plan; addresses are committed per community; corrupt files do not
// stop the Node; orders keep their own routes; limits and plain sentences.
async function grantRoleOn(
  node: RunningNode,
  creator: Phone,
  key: string,
  joiner: Phone,
  role: string,
) {
  await eventually(async () =>
    (await (await viewOf(node, key)).get(`members/${joiner.did}`)) ? true : undefined,
  );
  const view = await viewOf(node, key);
  const drafted = await issueRole({
    auth: creator.auth,
    creator: creator.did,
    spaceKey: key,
    view,
    grantor: creator.did,
    grantee: joiner.did,
    role,
    ...(role === "co-treasurer" ? { limit: { currency: "ZAR" as const, minor: 100_000 } } : {}),
    now: Date.now(),
    logTime: (await logTimeOf(view)) ?? Date.now(),
    days: 7,
  });
  if (!drafted.ok) throw new Error(drafted.error.message);
  const granted = await eventOf(
    key,
    creator,
    "role.granted",
    { role, grantee: joiner.did, expiresAt: drafted.value.expiresAt },
    drafted.value.tokens.map((t) => encodeProof(t)),
  );
  expect((await post(node, creator, key, granted)).status).toBe(200);
  await eventually(async () =>
    (await (await viewOf(node, key)).get(`roles/${joiner.did}/${role}`)) ? true : undefined,
  );
}

async function removeMember(node: RunningNode, creator: Phone, key: string, who: Phone) {
  const removal = await eventOf(key, creator, "member.removed", { member: who.did });
  expect((await post(node, creator, key, removal)).status).toBe(200);
  await eventually(async () =>
    (await (await viewOf(node, key)).get(`removed/${who.did}`)) ? true : undefined,
  );
}

describe("patch: removed people, addresses, files, limits", () => {
  const NOT_A_MEMBER = "You are not a member of this community any more.";

  it("refuses a removed driver's route plan", async () => {
    const node = await start();
    const { creator, member, key } = await community(node);
    await grantRoleOn(node, creator, key, member, "driver");
    const a = await registerPlace(node, creator, key, DEPOT);
    const b = await registerPlace(node, creator, key, HALL);
    await removeMember(node, creator, key, member);
    const plan = await call(node, member, "POST", `/communities/${key}/routes`, {
      order: "o1",
      origin: a.reply.json.id,
      destination: b.reply.json.id,
    });
    expect(plan.reply.status).toBe(403);
    expect(plan.reply.json.reason).toBe(NOT_A_MEMBER);
  });

  it("refuses a removed co-treasurer's place", async () => {
    const node = await start();
    const { creator, member, key } = await community(node);
    await grantRoleOn(node, creator, key, member, "co-treasurer");
    await removeMember(node, creator, key, member);
    const made = await call(node, member, "POST", `/communities/${key}/places`, {
      request: randomHex(16),
      label: DEPOT.label,
      area: DEPOT.area,
      lat: DEPOT.lat,
      lng: DEPOT.lng,
      address: ADDRESS,
    });
    expect(made.reply.status).toBe(403);
    expect(made.reply.json.reason).toBe(NOT_A_MEMBER);
  });

  it("commits the same address differently in two communities, and never as a phone number", async () => {
    const node = await start();
    const first = await community(node);
    const second = await community(node);
    const a = await call(node, first.creator, "POST", `/communities/${first.key}/places`, {
      request: randomHex(16),
      label: DEPOT.label,
      area: DEPOT.area,
      lat: DEPOT.lat,
      lng: DEPOT.lng,
      address: "0821234567",
    });
    const b = await call(node, second.creator, "POST", `/communities/${second.key}/places`, {
      request: randomHex(16),
      label: DEPOT.label,
      area: DEPOT.area,
      lat: DEPOT.lat,
      lng: DEPOT.lng,
      address: "0821234567",
    });
    expect(a.reply.status).toBe(200);
    expect(b.reply.status).toBe(200);
    expect(a.reply.json.addressCommitment).not.toBe(b.reply.json.addressCommitment);
    const secret = Buffer.from(SECRET, "hex");
    const phone = await commitPhoneNumber(secret, "0821234567", nodeHmacSha512);
    expect(a.reply.json.addressCommitment).not.toBe(phone);
    expect(await commitAddress(secret, "0821234567", nodeHmacSha512)).not.toBe(phone);
  });

  it("keeps an order's route apart from another order's with the same places", async () => {
    const node = await start();
    const { creator, key } = await community(node);
    const a = await registerPlace(node, creator, key, DEPOT);
    const b = await registerPlace(node, creator, key, HALL);
    const first = await call(node, creator, "POST", `/communities/${key}/routes`, {
      order: "o1",
      origin: a.reply.json.id,
      destination: b.reply.json.id,
    });
    const second = await call(node, creator, "POST", `/communities/${key}/routes`, {
      order: "o2",
      origin: a.reply.json.id,
      destination: b.reply.json.id,
    });
    expect(first.reply.status).toBe(200);
    expect(second.reply.status).toBe(200);
    const read = await call(
      node,
      creator,
      "GET",
      `/communities/${key}/route?order=o2&fingerprint=${second.reply.json.fingerprint as string}`,
    );
    expect(read.reply.status).toBe(200);
  });

  it("refuses a body over 16 KiB before it is read", async () => {
    const node = await start();
    const { creator, key } = await community(node);
    const big = await call(node, creator, "POST", `/communities/${key}/routes`, {
      order: "o1",
      origin: "x".repeat(20_000),
    });
    expect(big.reply.status).toBe(413);
  });

  it("limits how many plans one person may make in a window", async () => {
    const node = await start();
    const { creator, key } = await community(node);
    const a = await registerPlace(node, creator, key, DEPOT);
    const b = await registerPlace(node, creator, key, HALL);
    let last = 0;
    for (let i = 0; i < 40; i++) {
      last = (
        await call(node, creator, "POST", `/communities/${key}/routes`, {
          order: "o1",
          origin: a.reply.json.id,
          destination: b.reply.json.id,
        })
      ).reply.status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });

  it("says the nonce table is full in plain words, not 'already used'", () => {
    expect(nonceRefusalMessage("busy")).toBe("The Node is busy. Try again in a moment.");
    expect(nonceRefusalMessage("replayed")).toBe("That request was already used.");
  });

  it("uses plain words for a Node that is not ready", () => {
    expect(ROUTE_MESSAGES.record_off).toBe(
      "Your community's Node is not ready. Try again in a moment.",
    );
    expect(ROUTE_MESSAGES.no_secret).not.toMatch(/secret/i);
  });

  it("quarantines a corrupt places file and starts empty, and a failed write leaves memory unchanged", () => {
    const dir = mkdtempSync(join(tmpdir(), "ocn-places-"));
    folders.push(dir);
    writeFileSync(join(dir, "places.json"), "{ not json");
    const lines: string[] = [];
    const registry = new PlaceRegistry(dir, (line) => lines.push(line));
    expect(existsSync(join(dir, "places.json.bad"))).toBe(true);
    expect(lines.join(" ")).toMatch(/quarantined/);
    expect(registry.get("c", "a".repeat(64))).toBeUndefined();

    const blocked = mkdtempSync(join(tmpdir(), "ocn-places-"));
    folders.push(blocked);
    // A directory where the temporary file goes: the write fails, so memory must not change.
    mkdirSync(join(blocked, "places.json.tmp"));
    const stuck = new PlaceRegistry(blocked, () => undefined);
    expect(() =>
      stuck.put("c", "a".repeat(64), {
        label: "Depot",
        area: "Soweto",
        lat: 1,
        lng: 1,
        addressCommitment: "e".repeat(128),
      }),
    ).toThrow();
    expect(stuck.get("c", "a".repeat(64))).toBeUndefined();
  });

  it("quarantines a corrupt routes file too", () => {
    const dir = mkdtempSync(join(tmpdir(), "ocn-routes-"));
    folders.push(dir);
    writeFileSync(join(dir, "routes.json"), "[");
    const store = new RouteStore(dir, () => undefined);
    expect(existsSync(join(dir, "routes.json.bad"))).toBe(true);
    expect(store.get("c", "o1", "c".repeat(128))).toBeUndefined();
  });
});

describe("patch: a confirmation with a coordinate is refused by the sync route", () => {
  it("refuses a delivery.confirmed that carries latMicro and lngMicro", async () => {
    const node = await start();
    const { creator, key } = await community(node);
    const refused = await post(
      node,
      creator,
      key,
      rawEnvelope(key, creator, "delivery.confirmed", {
        order: "o1",
        photoSha512: "f".repeat(128),
        latMicro: -25_707_900,
        lngMicro: 28_400_400,
      }),
    );
    expect(refused.status).toBe(400);
    expect(refused.json.problem).toBe("invalid_event");
  });
});

describe("patch: a place is named, never addressed (the Node's own check)", () => {
  it("refuses a place whose label reads as an address", async () => {
    const node = await start();
    const { creator, key } = await community(node);
    const made = await call(node, creator, "POST", `/communities/${key}/places`, {
      request: randomHex(16),
      label: "14 Mkhize Street",
      area: "Mamelodi",
      lat: DEPOT.lat,
      lng: DEPOT.lng,
      address: ADDRESS,
    });
    expect(made.reply.status).toBe(400);
    expect(made.reply.json.problem).toBe("invalid_place");
  });
});

describe("story 7.3: a registration retried after a lost answer is one place (S-7.4-15)", () => {
  it("gives the same id when the same registration is sent again, and lists one place", async () => {
    const node = await start();
    const { creator, key } = await community(node);
    const request = randomHex(16);
    const body = {
      request,
      label: DEPOT.label,
      area: DEPOT.area,
      lat: DEPOT.lat,
      lng: DEPOT.lng,
      address: ADDRESS,
    };
    const first = await call(node, creator, "POST", `/communities/${key}/places`, body);
    const again = await call(node, creator, "POST", `/communities/${key}/places`, body);
    expect(first.reply.status).toBe(200);
    expect(again.reply.status).toBe(200);
    expect(again.reply.json.id).toBe(first.reply.json.id);
    expect(again.reply.json.addressCommitment).toBe(first.reply.json.addressCommitment);
    const listed = await call(node, creator, "GET", `/communities/${key}/places`);
    expect((listed.reply.json.places as unknown[]).length).toBe(1);
  });

  it("gives two different registrations two different places", async () => {
    const node = await start();
    const { creator, key } = await community(node);
    const a = await registerPlace(node, creator, key, DEPOT);
    const b = await registerPlace(node, creator, key, HALL);
    expect(a.reply.json.id).not.toBe(b.reply.json.id);
  });

  it("requires the registration key, so an unkeyed registration is refused", async () => {
    const node = await start();
    const { creator, key } = await community(node);
    const made = await call(node, creator, "POST", `/communities/${key}/places`, {
      label: DEPOT.label,
      area: DEPOT.area,
      lat: DEPOT.lat,
      lng: DEPOT.lng,
      address: ADDRESS,
    });
    expect(made.reply.status).toBe(400);
    expect(made.reply.json.problem).toBe("invalid_place");
  });
});

describe("story 7.3: members read the collection points, and never an address", () => {
  it("lets a member read the places with their coordinates, and refuses a stranger", async () => {
    const node = await start();
    const { creator, member, key } = await community(node);
    await registerPlace(node, creator, key, DEPOT);
    const listed = await call(node, member, "GET", `/communities/${key}/places`);
    expect(listed.reply.status).toBe(200);
    const [place] = listed.reply.json.places as Array<Record<string, unknown>>;
    expect(place).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{64}$/),
      label: DEPOT.label,
      area: DEPOT.area,
      lat: DEPOT.lat,
      lng: DEPOT.lng,
    });
    const stranger = await phone();
    const refused = await call(node, stranger, "GET", `/communities/${key}/places`);
    expect(refused.reply.status).not.toBe(200);
    expect(JSON.stringify(refused.reply.json)).not.toContain(String(DEPOT.lat));
  });

  it("never shows the address in the list, only its commitment", async () => {
    const node = await start();
    const { creator, member, key } = await community(node);
    await registerPlace(node, creator, key, DEPOT);
    const listed = await call(node, member, "GET", `/communities/${key}/places`);
    expect(JSON.stringify(listed.reply.json)).not.toContain("Church");
    expect(JSON.stringify(listed.reply.json)).not.toContain("addressCommitment");
  });
});
