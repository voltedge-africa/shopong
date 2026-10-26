// Story 3.6: deterministic capability checks in `apply`, judged at log time (the highest `claimedAt`
// accepted so far, held in the view), with a per-event cap on how far one event may move log time, and
// revocation (`role.revoked`) refused on later use. Each test is one row of the story's matrix.
import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import { createMemoryRecordNetwork, type MemoryRecordNetwork } from "@shopong/adapters-memory";
import {
  PERSONAL_DATA_MESSAGE,
  createEvent,
  webCryptoSha512,
  type EventEnvelope,
} from "@shopong/events";
import { money, type Did, type Space } from "@shopong/ports";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  DAY_MS,
  checkInvitation,
  communityDefinition,
  createCommunity,
  ROLES,
  encodeProof,
  formatDay,
  spaceUri,
  joinCommunity,
  type CommunityDeps,
} from "./index.js";

const T0 = 1_793_000_000_000;
const HOUR = 60 * 60 * 1000;
/** The per-event rise cap chosen in story 3.6 (a day). Written out here so the tests say what it is. */
const CAP = DAY_MS;
/** The view key that holds log time. */
const LOG_TIME = "log/time";
const TAKEN_BACK = "This role has been taken back.";
const NOT_ALLOWED_TO_TAKE_BACK =
  "Only the person who gave this role, or the creator, can take it back.";
const NOTHING_TO_TAKE_BACK = "There is no such role to take back.";

const rand = (n: number) => ({ currency: "ZAR" as const, minor: n * 100 });

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

const nonce = () => Array.from(randomBytes(16), (b) => b.toString(16).padStart(2, "0")).join("");

async function phone() {
  const auth = new IsoUcanCapabilityAuth();
  const did = await auth.createIdentity();
  const deps: CommunityDeps = { auth, sha512: webCryptoSha512, randomBytes };
  return { auth, did, deps };
}

type Phone = Awaited<ReturnType<typeof phone>>;

/** The creator's community on one in-memory record. */
async function world() {
  const network: MemoryRecordNetwork = createMemoryRecordNetwork();
  const creator = await phone();
  const made = await createCommunity(
    creator.deps,
    network.peer<EventEnvelope>(creator.did),
    "Ntombi Stokvel",
    T0,
  );
  if (!made.ok) throw new Error(made.error.message);
  return { network, creator, community: made.value, space: made.value.space };
}

type World = Awaited<ReturnType<typeof world>>;

/** Invite `p` (at `at`), have them join on their own replica, and sync. Returns their community and space. */
async function admit(w: World, p: Phone, at: number) {
  const invited = await w.community.invite(p.did, at);
  if (!invited.ok) throw new Error(invited.error.message);
  const space = await w.network
    .peer<EventEnvelope>(p.did)
    .open(w.community.space.key, communityDefinition(p.deps, w.creator.did, w.community.key));
  await w.network.replicate<EventEnvelope>(w.community.space, space);
  const checked = await checkInvitation({
    auth: p.auth,
    text: invited.value.code,
    me: p.did,
    now: at + HOUR,
    isUsed: async (id) => {
      await space.update();
      return (await space.view.get(`joined/${id}`)) !== undefined;
    },
  });
  if (!checked.ok) throw new Error(checked.error.message);
  const joined = await joinCommunity(p.deps, space, checked.value, at + HOUR);
  if (!joined.ok) throw new Error(joined.error.message);
  await sync(w, [space]);
  return { community: joined.value, space, token: invited.value.token, id: invited.value.id };
}

/** Exchange the creator's replica with each of the given replicas, both ways. */
async function sync(w: World, others: Space<EventEnvelope>[]) {
  for (let round = 0; round < 2; round++) {
    for (const other of others) await w.network.replicate<EventEnvelope>(w.space, other);
  }
}

/** The log time as the view holds it, after this replica catches up. */
async function logOf(space: Space<EventEnvelope>): Promise<number | undefined> {
  await space.update();
  const value = await space.view.get(LOG_TIME);
  return typeof value === "number" ? value : undefined;
}

/** Move log time forward to `to`, one accepted creator event at a time, each at most one cap ahead. */
async function advanceLog(w: World, to: number) {
  for (let step = 0; step < 100; step++) {
    const at = (await logOf(w.space)) ?? T0;
    if (at >= to) return;
    const next = Math.min(to, at + CAP);
    const done = await w.community.addQuote(quote(`Step ${step}`), next);
    if (!done.ok) throw new Error(done.error.message);
  }
  throw new Error("log time did not reach the target");
}

function quote(order: string) {
  return {
    supplier: "Thandi Wholesale",
    order,
    lines: [{ item: "Sugar", unit: "bag", packSize: 1, pricePerPackCents: 12500 }],
    delivery: { feeCents: 0, days: 0 },
  };
}

/** A raw event with any actor, payload and proof. Returns the plain reason it was refused, if it was. */
async function raw(
  space: Space<EventEnvelope>,
  spaceKey: string,
  event: {
    type: string;
    actor: Did;
    payload: Record<string, unknown>;
    proof?: string[];
    at: number;
  },
): Promise<string | undefined> {
  const built = createEvent({
    type: event.type,
    space: spaceKey,
    actor: event.actor,
    proof: event.proof ?? [],
    claimedAt: event.at,
    nonce: nonce(),
    payload: event.payload,
  } as never) as EventEnvelope;
  const receipt = await space.append(built);
  if (!receipt.ok) throw new Error(receipt.error.message);
  await space.update();
  const rejected = await space.view.get(`rejected/${receipt.value.id}`);
  const reason =
    typeof rejected === "object" && rejected !== null && !Array.isArray(rejected)
      ? (rejected as { reason?: unknown }).reason
      : undefined;
  return typeof reason === "string" ? reason : undefined;
}

/** A co-treasurer for 7 days, given by the creator at `at`, and synced to everyone. */
async function coTreasurer(w: World, at: number) {
  const co = await phone();
  const member = await admit(w, co, at);
  const granted = await w.community.grantRole(
    co.did,
    "co-treasurer",
    { limit: rand(1000), days: 7 },
    at + HOUR,
  );
  if (!granted.ok) throw new Error(granted.error.message);
  await sync(w, [member.space]);
  return { ...member, phone: co, expiresAt: granted.value.expiresAt };
}

describe("log time", () => {
  it("is the founder's join, then rises to the latest claimedAt accepted", async () => {
    const w = await world();
    expect(await logOf(w.space)).toBe(T0);
    const done = await w.community.addQuote(quote("Groceries"), T0 + HOUR);
    expect(done.ok).toBe(true);
    expect(await logOf(w.space)).toBe(T0 + HOUR);
  });

  it("never moves back: a backdated accepted event leaves log time where it was", async () => {
    const w = await world();
    await w.community.addQuote(quote("Groceries"), T0 + 2 * HOUR);
    const backdated = await w.community.addQuote(quote("Other"), T0 + HOUR);
    expect(backdated.ok).toBe(true);
    expect(await logOf(w.space)).toBe(T0 + 2 * HOUR);
  });

  it("a claim more than the cap ahead is judged at the current log time, and log time rises by exactly the cap", async () => {
    const w = await world();
    const start = (await logOf(w.space)) ?? T0;
    const far = await w.community.addQuote(quote("Groceries"), start + CAP + HOUR);
    expect(far.ok).toBe(true);
    expect(await logOf(w.space)).toBe(start + CAP);
  });

  it("two days of silence, then an honest join is accepted, and so is the next event", async () => {
    const w = await world();
    const newbie = await phone();
    // The creator invites and the newbie joins two days after the last accepted event.
    const member = await admit(w, newbie, T0 + 2 * DAY_MS);
    const members = (await member.community.members()).map((m) => m.did);
    expect(members).toContain(newbie.did);
    const after = await w.community.addQuote(quote("After silence"), T0 + 2 * DAY_MS + 2 * HOUR);
    expect(after.ok).toBe(true);
    expect(await logOf(w.space)).toBe(T0 + 2 * DAY_MS + 2 * HOUR);
  });

  it("accepts a rise of exactly the cap", async () => {
    const w = await world();
    const start = (await logOf(w.space)) ?? T0;
    const edge = await w.community.addQuote(quote("Groceries"), start + CAP);
    expect(edge.ok).toBe(true);
    expect(await logOf(w.space)).toBe(start + CAP);
  });

  it("an event refused by its own checks does not move log time", async () => {
    const w = await world();
    const member = await admit(w, await phone(), T0);
    const before = await logOf(w.space);
    const reason = await raw(member.space, w.community.key, {
      type: "quote.added",
      actor: member.community.me,
      payload: {},
      at: (before ?? T0) + HOUR,
    });
    expect(reason).toBe("Only the treasurer can add a quote.");
    expect(await logOf(w.space)).toBe(before);
  });
});

describe("the personal-data guard runs before log time is judged", () => {
  it("refuses a raw phone number in a record event, even one claimed far past log time, and log time stays", async () => {
    const w = await world();
    const before = await logOf(w.space);
    const reason = await raw(w.space, w.community.key, {
      type: "role.revoked",
      actor: w.creator.did,
      payload: { role: "co-treasurer", grantee: w.creator.did, phone: "0821234567" },
      at: (before ?? T0) + 10 * DAY_MS,
    });
    expect(reason).toBe(PERSONAL_DATA_MESSAGE);
    expect(await logOf(w.space)).toBe(before);
  });
});

describe("a role at log time", () => {
  it("is in force while log time is before its end", async () => {
    const w = await world();
    const co = await coTreasurer(w, T0 + HOUR);
    const done = await co.community.addQuote(quote("In time"), T0 + 2 * HOUR);
    expect(done.ok).toBe(true);
  });

  it("refuses a backdated quote by a co-treasurer whose role ended in log time (phone with a fresh copy)", async () => {
    const w = await world();
    const co = await coTreasurer(w, T0 + HOUR);
    await advanceLog(w, co.expiresAt + HOUR);
    await sync(w, [co.space]);
    // Claimed at a time when the role was still in force, but written after log time passed its end.
    const backdated = await co.community.addQuote(quote("Backdated"), T0 + 2 * HOUR);
    expect(backdated.ok).toBe(false);
    if (!backdated.ok)
      expect(backdated.error.message).toBe(`Your role ended on ${formatDay(co.expiresAt)}.`);
  });

  it("apply refuses a backdated quote written by a co-treasurer who bypasses the phone", async () => {
    const w = await world();
    const co = await coTreasurer(w, T0 + HOUR);
    await advanceLog(w, co.expiresAt + HOUR);
    // The co-treasurer's replica has the advanced log, so the event is placed after the role's end.
    await sync(w, [co.space]);
    const reason = await raw(co.space, w.community.key, {
      type: "quote.added",
      actor: co.community.me,
      payload: {},
      at: T0 + 2 * HOUR,
    });
    expect(reason).toBe(`Your role ended on ${formatDay(co.expiresAt)}.`);
  });

  it("refuses a co-treasurer's invitation written after log time passed the role's end", async () => {
    const w = await world();
    const co = await coTreasurer(w, T0 + HOUR);
    await advanceLog(w, co.expiresAt + HOUR);
    await sync(w, [co.space]);
    const newbie = await phone();
    const inviteAttempt = await raw(co.space, w.community.key, {
      type: "member.invited",
      actor: co.community.me,
      payload: { invitation: "not-a-real-token", invitee: newbie.did, expiresAt: T0 + 9 * DAY_MS },
      at: T0 + 2 * HOUR,
    });
    expect(inviteAttempt).toBe("Only the creator can invite.");
  });
});

describe("revoking a role (role.revoked)", () => {
  it("refuses a quote by a co-treasurer whose role was taken back, and says so plainly", async () => {
    const w = await world();
    const co = await coTreasurer(w, T0 + HOUR);
    const revoked = await raw(w.space, w.community.key, {
      type: "role.revoked",
      actor: w.creator.did,
      payload: { role: "co-treasurer", grantee: co.community.me },
      at: T0 + 3 * HOUR,
    });
    expect(revoked).toBeUndefined();
    await sync(w, [co.space]);
    const later = await co.community.addQuote(quote("After"), T0 + 4 * HOUR);
    expect(later.ok).toBe(false);
    if (!later.ok) expect(later.error.message).toBe(TAKEN_BACK);
    const asked = await co.community.checkAction({ ability: "payment/approve", amount: rand(10) });
    expect(asked.ok).toBe(false);
    if (!asked.ok) expect(asked.error.message).toBe(TAKEN_BACK);
  });

  it("refuses a join through a co-treasurer's invitation after that role was taken back", async () => {
    const w = await world();
    const co = await coTreasurer(w, T0 + HOUR);
    const newbie = await phone();
    const invited = await co.community.invite(newbie.did, T0 + 2 * HOUR);
    if (!invited.ok) throw new Error(invited.error.message);
    // The invitation reaches the creator before the revocation, so the record orders it first.
    await sync(w, [co.space]);
    await raw(w.space, w.community.key, {
      type: "role.revoked",
      actor: w.creator.did,
      payload: { role: "co-treasurer", grantee: co.community.me },
      at: T0 + 3 * HOUR,
    });
    await sync(w, [co.space]);
    const newbieSpace = await w.network
      .peer<EventEnvelope>(newbie.did)
      .open(
        w.community.space.key,
        communityDefinition(newbie.deps, w.creator.did, w.community.key),
      );
    await w.network.replicate<EventEnvelope>(w.space, newbieSpace);
    await newbieSpace.update();
    const reason = await raw(newbieSpace, w.community.key, {
      type: "member.joined",
      actor: newbie.did,
      payload: { invitation: invited.value.id },
      proof: [encodeProof(invited.value.token)],
      at: T0 + 4 * HOUR,
    });
    expect(reason).toBe(TAKEN_BACK);
  });

  it("refuses a revocation by someone who neither gave the role nor is the creator", async () => {
    const w = await world();
    const co = await coTreasurer(w, T0 + HOUR);
    const other = await admit(w, await phone(), T0 + 2 * HOUR);
    const reason = await raw(other.space, w.community.key, {
      type: "role.revoked",
      actor: other.community.me,
      payload: { role: "co-treasurer", grantee: co.community.me },
      at: T0 + 3 * HOUR,
    });
    expect(reason).toBe(NOT_ALLOWED_TO_TAKE_BACK);
  });

  it("refuses a revocation of a role that was never given", async () => {
    const w = await world();
    const reason = await raw(w.space, w.community.key, {
      type: "role.revoked",
      actor: w.creator.did,
      payload: { role: "driver", grantee: w.creator.did },
      at: T0 + HOUR,
    });
    expect(reason).toBe(NOTHING_TO_TAKE_BACK);
  });
});

describe("replay and rebuild", () => {
  it("replaying the same log on another date gives the same view, and apply reads no clock", async () => {
    const w = await world();
    const co = await coTreasurer(w, T0 + HOUR);
    await co.community.addQuote(quote("In time"), T0 + 2 * HOUR);
    await advanceLog(w, T0 + 3 * DAY_MS);
    await sync(w, [co.space]);
    const creatorView = await w.space.view.list("");

    const late = await phone();
    const lateSpace = await w.network
      .peer<EventEnvelope>(late.did)
      .open(w.community.space.key, communityDefinition(late.deps, w.creator.did, w.community.key));
    const clock = vi.spyOn(Date, "now").mockReturnValue(T0 + 400 * DAY_MS);
    try {
      await w.network.replicate<EventEnvelope>(w.space, lateSpace);
      await lateSpace.update();
      expect(clock).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
    expect(await lateSpace.view.list("")).toEqual(creatorView);
  });

  it("rebuilding in a different arrival order gives the same view", async () => {
    const w = await world();
    const co = await coTreasurer(w, T0 + HOUR);
    await co.community.addQuote(quote("From co-treasurer"), T0 + 2 * HOUR);
    await advanceLog(w, T0 + 3 * DAY_MS);
    await sync(w, [co.space]);

    const replicaOf = async (who: Phone) =>
      w.network
        .peer<EventEnvelope>(who.did)
        .open(w.community.space.key, communityDefinition(who.deps, w.creator.did, w.community.key));
    const first = await replicaOf(await phone());
    const second = await replicaOf(await phone());
    // The same two writers' logs, handed to two replicas in opposite orders.
    await w.network.replicate<EventEnvelope>(w.space, first);
    await w.network.replicate<EventEnvelope>(co.space, first);
    await w.network.replicate<EventEnvelope>(co.space, second);
    await w.network.replicate<EventEnvelope>(w.space, second);
    await first.update();
    await second.update();
    const expected = await w.space.view.list("");
    expect(await first.view.list("")).toEqual(expected);
    expect(await second.view.list("")).toEqual(expected);
  });
});

/** The reason a claimed time that is not a valid time gets (story 3.6, review item 3). */
const CLAIM = "This event has no valid time.";
const MISSING = Symbol("missing");

/**
 * A raw event with whatever `claimedAt` is given (or none), written as an admitted writer without going
 * through `createEvent`, which would refuse it before it reached the record.
 */
async function appendClaim(
  space: Space<EventEnvelope>,
  spaceKey: string,
  actor: Did,
  claimedAt: unknown,
): Promise<string | undefined> {
  const event: Record<string, unknown> = {
    v: 1,
    type: "quote.added",
    space: spaceKey,
    actor,
    proof: [],
    nonce: nonce(),
    payload: {},
  };
  if (claimedAt !== MISSING) event.claimedAt = claimedAt;
  const receipt = await space.append(event as never);
  if (!receipt.ok) throw new Error(receipt.error.message);
  await space.update();
  const rejected = await space.view.get(`rejected/${receipt.value.id}`);
  const reason =
    typeof rejected === "object" && rejected !== null && !Array.isArray(rejected)
      ? (rejected as { reason?: unknown }).reason
      : undefined;
  return typeof reason === "string" ? reason : undefined;
}

describe("a revoked or replaced ancestor stops a co-treasurer's invite and quote (review item 2)", () => {
  /** G is co-treasurer (given by the creator), and G gives B the co-treasurer role. */
  async function chain() {
    const w = await world();
    const g = await coTreasurer(w, T0 + HOUR);
    const b = await admit(w, await phone(), T0 + 2 * HOUR);
    await sync(w, [g.space, b.space]);
    const given = await g.community.grantRole(
      b.community.me,
      "co-treasurer",
      { limit: rand(500), days: 7 },
      T0 + HOUR,
    );
    if (!given.ok) throw new Error(given.error.message);
    await sync(w, [g.space, b.space]);
    return { w, g, b };
  }

  it("creator takes G's role back: B's invite is refused in apply", async () => {
    const { w, g, b } = await chain();
    await raw(w.space, w.community.key, {
      type: "role.revoked",
      actor: w.creator.did,
      payload: { role: "co-treasurer", grantee: g.community.me },
      at: T0 + 4 * HOUR,
    });
    await sync(w, [g.space, b.space]);
    const reason = await raw(b.space, w.community.key, {
      type: "member.invited",
      actor: b.community.me,
      payload: {
        invitation: "not-a-token",
        invitee: (await phone()).did,
        expiresAt: T0 + 9 * DAY_MS,
      },
      at: T0 + 5 * HOUR,
    });
    expect(reason).toBe("Only the creator can invite.");
  });

  it("creator takes G's role back: B's quote is refused in apply, and says the role was taken back", async () => {
    const { w, g, b } = await chain();
    await raw(w.space, w.community.key, {
      type: "role.revoked",
      actor: w.creator.did,
      payload: { role: "co-treasurer", grantee: g.community.me },
      at: T0 + 4 * HOUR,
    });
    await sync(w, [g.space, b.space]);
    const reason = await raw(b.space, w.community.key, {
      type: "quote.added",
      actor: b.community.me,
      payload: {},
      at: T0 + 5 * HOUR,
    });
    expect(reason).toBe("This role has been taken back.");
  });

  it("creator gives G the role again: B's invite is refused in apply (G's old grant is no longer current)", async () => {
    const { w, g, b } = await chain();
    const again = await w.community.grantRole(
      g.community.me,
      "co-treasurer",
      { limit: rand(1000), days: 7 },
      T0 + 4 * HOUR,
    );
    if (!again.ok) throw new Error(again.error.message);
    await sync(w, [g.space, b.space]);
    const reason = await raw(b.space, w.community.key, {
      type: "member.invited",
      actor: b.community.me,
      payload: {
        invitation: "not-a-token",
        invitee: (await phone()).did,
        expiresAt: T0 + 9 * DAY_MS,
      },
      at: T0 + 5 * HOUR,
    });
    expect(reason).toBe("Only the creator can invite.");
  });
});

describe("a role whose ancestor was taken back (review item 7)", () => {
  it("is refused in recordRoleGrant with the taken-back sentence", async () => {
    const w = await world();
    const g = await coTreasurer(w, T0 + HOUR);
    const b = await admit(w, await phone(), T0 + 2 * HOUR);
    // G's own grants, from G's record, so G can build B's delegations the way a phone would.
    const gRoles = await g.community.roles();
    const parents = gRoles.flatMap((record) => record.grants);
    const tokens: string[] = [];
    for (const ability of ROLES["co-treasurer"].abilities) {
      const parent = parents.find((grant) => grant.ability === ability);
      if (parent === undefined) throw new Error("no parent grant");
      const decoded = await g.phone.auth.decode(parent.token);
      if (!decoded.ok) throw new Error("parent does not decode");
      const issued = await g.phone.auth.issue({
        issuer: g.community.me,
        audience: b.community.me,
        capabilities: [
          {
            with: spaceUri(w.community.key),
            can: ability,
            ...(parent.limit === undefined ? {} : { ceiling: money("ZAR", parent.limit.minor) }),
          },
        ],
        notBefore: decoded.value.notBefore,
        expiresAt: decoded.value.expiresAt,
        proofs: [parent.token],
      });
      if (!issued.ok) throw new Error(issued.error.message);
      tokens.push(encodeProof(issued.value));
    }
    const expiresAt = await g.phone.auth.decode(parents[0]?.token as never);
    if (!expiresAt.ok) throw new Error("no expiry");
    await raw(w.space, w.community.key, {
      type: "role.revoked",
      actor: w.creator.did,
      payload: { role: "co-treasurer", grantee: g.community.me },
      at: T0 + 3 * HOUR,
    });
    await sync(w, [g.space, b.space]);
    const reason = await raw(g.space, w.community.key, {
      type: "role.granted",
      actor: g.community.me,
      payload: {
        role: "co-treasurer",
        grantee: b.community.me,
        expiresAt: expiresAt.value.expiresAt,
      },
      proof: tokens,
      at: T0 + 4 * HOUR,
    });
    expect(reason).toBe("This role has been taken back.");
  });
});

describe("a claimed time that is not a valid time (review items 3 and 4)", () => {
  for (const [label, value] of [
    ["missing", MISSING],
    ["a string", "1793000000000"],
    ["fractional", 1.5],
    ["negative", -1],
    ["NaN", Number.NaN],
  ] as const) {
    it(`refuses a ${label} claimedAt from an admitted writer, with a plain reason, and log time does not move`, async () => {
      const w = await world();
      const co = await coTreasurer(w, T0 + HOUR);
      const before = await logOf(w.space);
      const reason = await appendClaim(co.space, w.community.key, co.community.me, value);
      expect(reason).toBe(CLAIM);
      expect(await logOf(w.space)).toBe(before);
    });
  }

  it("gives the same view on a replica that replays the invalid events in another order", async () => {
    const w = await world();
    const co = await coTreasurer(w, T0 + HOUR);
    for (const value of [MISSING, "1793000000000", 1.5, -1, Number.NaN]) {
      await appendClaim(co.space, w.community.key, co.community.me, value);
    }
    await sync(w, [co.space]);
    await w.space.update();
    const expected = await w.space.view.list("");
    const replicaOf = async () =>
      w.network
        .peer<EventEnvelope>((await phone()).did)
        .open(
          w.community.space.key,
          communityDefinition((await phone()).deps, w.creator.did, w.community.key),
        );
    const first = await replicaOf();
    const second = await replicaOf();
    await w.network.replicate<EventEnvelope>(w.space, first);
    await w.network.replicate<EventEnvelope>(co.space, first);
    await w.network.replicate<EventEnvelope>(co.space, second);
    await w.network.replicate<EventEnvelope>(w.space, second);
    await first.update();
    await second.update();
    expect(await first.view.list("")).toEqual(expected);
    expect(await second.view.list("")).toEqual(expected);
  });
});
