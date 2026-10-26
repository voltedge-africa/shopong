// Removing a member by capability (story 3.3): who may remove whom, the creator, the last indexer, earlier
// events, later appends, re-admission and role grants. Each case is one row of the story's matrix.
import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import { createMemoryRecordNetwork, type MemoryRecordNetwork } from "@shopong/adapters-memory";
import { createEvent, webCryptoSha512, type EventEnvelope } from "@shopong/events";
import type { ApplyHost, Did, EventId, RecordEntry, Space, ViewWriter } from "@shopong/ports";
import { describe, expect, it, vi } from "vite-plus/test";

// Each case makes several identities and syncs several replicas; under the parallel CI run that takes longer than the default.
vi.setConfig({ testTimeout: 30_000 });
import {
  DAY_MS,
  INVITATION_MESSAGES,
  checkInvitation,
  communityDefinition,
  createCommunity,
  joinCommunity,
  type CommunityDeps,
} from "./index.js";
import { appendChecked, type Community as CommunityHandle } from "./community.js";
import { createCommunityApply, NOT_THE_WRITER, REMOVAL_MESSAGES } from "./apply.js";
import { coTreasurerJoinRecorded, isCurrentGrantIn, rolesOf } from "./roles.js";
import { CLAIM_MESSAGE } from "./log-time.js";

const T0 = 1_793_000_000_000;
const RAND = 100;
const rand = (n: number) => ({ currency: "ZAR" as const, minor: n * RAND });
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

interface Phone {
  readonly auth: IsoUcanCapabilityAuth;
  readonly did: Did;
  readonly deps: CommunityDeps;
}

async function phone(): Promise<Phone> {
  const auth = new IsoUcanCapabilityAuth();
  const did = await auth.createIdentity();
  const deps: CommunityDeps = { auth, sha512: webCryptoSha512, randomBytes };
  return { auth, did, deps };
}

/** A phone whose DID sorts after `after`, so its own entries are linearised after the creator's (see the partition test). */
async function phoneSortingAfter(after: string): Promise<Phone> {
  for (;;) {
    const p = await phone();
    if (p.did > after) return p;
  }
}

/** The fixture `town()` returns. */
type Town = Awaited<ReturnType<typeof town>>;

/**
 * Moves the record's log time to `to`, one accepted creator invitation a day. Each accepted event may raise log time by
 * at most one day (story 3.6), so this is the way to move it past a role's end in a test.
 */
async function advanceLog(t: Town, to: number): Promise<void> {
  for (let at = T0 + DAY_MS; at <= to; at += DAY_MS) {
    const invited = await t.community.invite((await phone()).did, at);
    if (!invited.ok) throw new Error(invited.error.message);
  }
  await t.sync();
}

/** A creator with a community, and helpers that admit people and remove them through the record. */
async function town() {
  const network: MemoryRecordNetwork = createMemoryRecordNetwork();
  const creator = await phone();
  const made = await createCommunity(
    creator.deps,
    network.peer<EventEnvelope>(creator.did),
    "Removal Stokvel",
    T0,
  );
  if (!made.ok) throw new Error(made.error.message);
  const community = made.value;
  const phones = new Map<Did, Phone>([[creator.did, creator]]);
  const members: CommunityHandle[] = [community];
  /** The invitation text each person was given, by DID, so a test can present an old one again. */
  const codes = new Map<Did, string>();

  /** Invite a person, have them join on their own phone, and sync. Returns their community. */
  async function admit(p: Phone, now = T0): Promise<CommunityHandle> {
    phones.set(p.did, p);
    const invited = await community.invite(p.did, now);
    if (!invited.ok) throw new Error(invited.error.message);
    codes.set(p.did, invited.value.code);
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

  /** Exchange every replica with the creator's, twice, so an event reaches everyone who needs it. */
  async function sync(): Promise<void> {
    for (let round = 0; round < 2; round++) {
      for (const member of members) {
        await network.replicate<EventEnvelope>(community.space, member.space);
      }
    }
  }

  /** Give a role on `giver`'s phone, then sync, so everyone sees it. */
  async function grant(
    giver: CommunityHandle,
    grantee: CommunityHandle,
    role: string,
    days?: number,
  ): Promise<void> {
    const limit = rand(1000);
    const granted = await giver.grantRole(
      grantee.me,
      role,
      days === undefined ? { limit } : { limit, days },
      T0 + 2 * DAY_MS,
    );
    if (!granted.ok) throw new Error(granted.error.message);
    await sync();
  }

  /**
   * Appends `member.removed` as `by`, through `by`'s own replica. Returns the reason the record refused it, or
   * undefined when it was applied, or `append:<code>` when the append itself was refused.
   */
  async function remove(
    by: CommunityHandle,
    member: string,
    at = T0 + 2 * DAY_MS,
  ): Promise<string | undefined> {
    const event = createEvent({
      type: "member.removed",
      space: community.key,
      actor: by.me,
      proof: [],
      claimedAt: at,
      nonce: hex(randomBytes(16)),
      payload: { member },
    } as never) as EventEnvelope;
    const receipt = await appendChecked(by.space, event);
    if (!receipt.ok) return `append:${receipt.error.code}`;
    await sync();
    await by.space.update();
    const rejected = await by.space.view.get(`rejected/${receipt.value.id}`);
    return rejected === undefined ? undefined : (rejected as { reason: string }).reason;
  }

  /** The `member.removed` event as `by` writes it, not yet appended. */
  function removalEvent(by: Did, member: Did, at = T0 + 2 * DAY_MS): EventEnvelope {
    return createEvent({
      type: "member.removed",
      space: community.key,
      actor: by,
      proof: [],
      claimedAt: at,
      nonce: hex(randomBytes(16)),
      payload: { member },
    } as never) as EventEnvelope;
  }

  async function membersOf(space: Space<EventEnvelope>): Promise<string[]> {
    await space.update();
    return (await space.view.list("members/")).map((e) => e.key.slice("members/".length)).sort();
  }

  return {
    network,
    creator,
    community,
    phones,
    members,
    admit,
    sync,
    grant,
    remove,
    removalEvent,
    membersOf,
    codes,
  };
}

describe("removing a member by capability", () => {
  it("the creator removes a member: the member leaves the list, and later appends are refused as not writable", async () => {
    const t = await town();
    const bob = await t.admit(await phone());
    const carol = await t.admit(await phone());
    expect(await t.membersOf(t.community.space)).toEqual([t.creator.did, bob.me, carol.me].sort());

    expect(await t.remove(t.community, bob.me)).toBeUndefined();

    expect(await t.membersOf(t.community.space)).toEqual([t.creator.did, carol.me].sort());
    expect(await t.membersOf(carol.space)).toEqual([t.creator.did, carol.me].sort());
    await bob.space.update();
    expect(await bob.space.writable()).toBe(false);
    const later = await bob.space.append(
      createEvent({
        type: "member.removed",
        space: t.community.key,
        actor: bob.me,
        proof: [],
        claimedAt: T0 + 3 * DAY_MS,
        nonce: hex(randomBytes(16)),
        payload: { member: carol.me },
      } as never) as EventEnvelope,
    );
    expect(later).toMatchObject({ ok: false, error: { code: "not_writable" } });
  });

  it("a co-treasurer may remove a member", async () => {
    const t = await town();
    const cotr = await t.admit(await phone());
    const dave = await t.admit(await phone());
    await t.grant(t.community, cotr, "co-treasurer");

    expect(await t.remove(cotr, dave.me)).toBeUndefined();
    expect(await t.membersOf(t.community.space)).not.toContain(dave.me);
  });

  it("a plain member may not remove another member, and the refusal is recorded", async () => {
    const t = await town();
    const erin = await t.admit(await phone());
    const frank = await t.admit(await phone());

    expect(await t.remove(erin, frank.me)).toBe(REMOVAL_MESSAGES.not_permitted);
    expect(await t.membersOf(t.community.space)).toContain(frank.me);
  });

  it("a member may leave by removing themselves", async () => {
    const t = await town();
    const gina = await t.admit(await phone());

    expect(await t.remove(gina, gina.me)).toBeUndefined();
    expect(await t.membersOf(t.community.space)).not.toContain(gina.me);
  });

  it("nobody removes the creator: not the creator, and not a co-treasurer", async () => {
    const t = await town();
    const cotr = await t.admit(await phone());
    await t.grant(t.community, cotr, "co-treasurer");

    expect(await t.remove(t.community, t.creator.did)).toBe(REMOVAL_MESSAGES.creator_not_removable);
    expect(await t.remove(cotr, t.creator.did)).toBe(REMOVAL_MESSAGES.creator_not_removable);
    expect(await t.membersOf(t.community.space)).toContain(t.creator.did);
  });

  it("removing someone who is not a member is refused", async () => {
    const t = await town();
    const stranger = await phone();

    expect(await t.remove(t.community, stranger.did)).toBe(REMOVAL_MESSAGES.not_a_member);
  });

  it("an earlier join of a removed member stays in the view on every replica", async () => {
    const t = await town();
    const hana = await t.admit(await phone());
    const ivan = await t.admit(await phone());
    expect(await t.remove(t.community, hana.me)).toBeUndefined();

    for (const space of [t.community.space, ivan.space]) {
      await space.update();
      const joined = await space.view.list("joined/");
      expect(joined.map((e) => (e.value as { member: string }).member)).toContain(hana.me);
    }
  });

  it("removal leaves role grants as they were", async () => {
    const t = await town();
    const cotr = await t.admit(await phone());
    await t.grant(t.community, cotr, "co-treasurer");
    const before = await rolesOf(t.community.space.view, cotr.me);
    expect(before.length).toBeGreaterThan(0);

    expect(await t.remove(t.community, cotr.me)).toBeUndefined();
    expect(await rolesOf(t.community.space.view, cotr.me)).toEqual(before);
  });

  it("a removed member is admitted again by a fresh invitation and join, and the old invitation is refused", async () => {
    const t = await town();
    const jabu = await t.admit(await phone());
    const oldCode = t.codes.get(jabu.me) as string;
    expect(await t.remove(t.community, jabu.me)).toBeUndefined();

    const readmitted = await t.admit(t.phones.get(jabu.me)!, T0 + 3 * DAY_MS);
    expect(readmitted.me).toBe(jabu.me);
    expect(await t.membersOf(t.community.space)).toContain(jabu.me);

    const replay = await checkInvitation({
      auth: t.phones.get(jabu.me)!.auth,
      text: oldCode,
      me: jabu.me,
      now: T0 + 4 * DAY_MS,
      isUsed: async (id) => {
        await t.community.space.update();
        return (await t.community.space.view.get(`joined/${id}`)) !== undefined;
      },
      mayPassOn: () => false,
      isCurrentGrant: () => false,
    });
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.error.message).toBe(INVITATION_MESSAGES.already_used);
  });
});

describe("the community's indexers", () => {
  it("the creator is the only indexer when the community is made", async () => {
    const t = await town();
    await t.community.space.update();
    const indexers = (await t.community.space.view.list("indexers/")).map((e) => e.key);
    expect(indexers).toEqual([`indexers/${t.creator.did}`]);
  });
});

/** Runs the community's `apply` on one removal, over a plain in-memory view, and reports what the host was asked. */
async function applyRemoval(options: {
  actor: Did;
  /** The event's claimed time. Absent: a valid time. Given: written as a plain envelope, so any value reaches `apply`. */
  claimedAt?: unknown;
  /** Who appended the entry; defaults to the actor. Differs from the actor only in the forged-actor test. */
  writer?: Did;
  creator: Did;
  member: Did;
  seed: Record<string, unknown>;
}) {
  const auth = new IsoUcanCapabilityAuth();
  const spaceKey = "ab".repeat(32);
  const data = new Map<string, unknown>(Object.entries(options.seed));
  const view: ViewWriter = {
    get: async (key) => data.get(key) as never,
    list: async (prefix) =>
      [...data.keys()]
        .sort()
        .filter((k) => k.startsWith(prefix))
        .map((key) => ({ key, value: data.get(key) as never })),
    put: async (key, value) => {
      data.set(key, value as never);
    },
    del: async (key) => {
      data.delete(key);
    },
  };
  const removed: string[] = [];
  const host: ApplyHost = {
    addWriter: async () => {},
    removeWriter: async (did) => {
      removed.push(did);
    },
  };
  const fields = {
    v: 1,
    type: "member.removed",
    space: spaceKey,
    actor: options.actor,
    proof: [],
    claimedAt: options.claimedAt ?? T0 + DAY_MS,
    nonce: hex(randomBytes(16)),
    payload: { member: options.member },
  };
  // A claim that is not a valid time is written as a plain envelope, so it reaches `apply` (the envelope check would refuse it first).
  const event = (
    options.claimedAt === undefined ? createEvent(fields as never) : fields
  ) as EventEnvelope;
  const id = `id-${hex(randomBytes(4))}` as EventId;
  const entries: RecordEntry<EventEnvelope>[] = [
    { id, writer: options.writer ?? options.actor, event },
  ];
  const apply = createCommunityApply({ auth, creator: options.creator, spaceKey });
  await apply(entries, view, host);
  return {
    data,
    removed,
    reason: (data.get(`rejected/${id}`) as { reason: string } | undefined)?.reason,
  };
}

describe("the last indexer", () => {
  const people = async () => {
    const auth = new IsoUcanCapabilityAuth();
    return { creator: await auth.createIdentity(), member: await auth.createIdentity() };
  };

  it("refuses a removal that would leave no indexer, and keeps the member", async () => {
    const { creator, member } = await people();
    // Only the member is flagged as an indexer; the creator is not in the set (the set must never be left empty).
    const seed = {
      [`members/${member}`]: { invitation: "x", joinedAt: T0 },
      [`indexers/${member}`]: true,
    };
    const result = await applyRemoval({ actor: creator, creator, member, seed });

    expect(result.reason).toBe(REMOVAL_MESSAGES.last_indexer);
    expect(result.removed).toEqual([]);
    expect(result.data.has(`members/${member}`)).toBe(true);
    expect(result.data.has(`indexers/${member}`)).toBe(true);
  });

  it("with a second flagged indexer, the other one may be removed", async () => {
    const { creator, member } = await people();
    const seed = {
      [`members/${creator}`]: { invitation: "founder", joinedAt: T0 },
      [`indexers/${creator}`]: true,
      [`members/${member}`]: { invitation: "x", joinedAt: T0 },
      [`indexers/${member}`]: true,
    };
    const result = await applyRemoval({ actor: creator, creator, member, seed });

    expect(result.reason).toBeUndefined();
    expect(result.removed).toEqual([member]);
    expect(result.data.has(`members/${member}`)).toBe(false);
    expect(result.data.has(`indexers/${member}`)).toBe(false);
    expect(result.data.has(`indexers/${creator}`)).toBe(true);
  });
});

describe("removal: forged, expired, partitioned and convergent", () => {
  it("a forged actor on member.removed is refused: the writer is not the person the event names", async () => {
    const auth = new IsoUcanCapabilityAuth();
    const creator = await auth.createIdentity();
    const forger = await auth.createIdentity();
    const carol = await auth.createIdentity();
    const seed = {
      [`members/${carol}`]: { invitation: "x", joinedAt: T0 },
      [`indexers/${creator}`]: true,
    };
    // The entry was appended by `forger`, but the event names the creator as its actor.
    const result = await applyRemoval({
      actor: creator,
      writer: forger,
      creator,
      member: carol,
      seed,
    });

    expect(result.reason).toBe(NOT_THE_WRITER);
    expect(result.removed).toEqual([]);
    expect(result.data.has(`members/${carol}`)).toBe(true);
  });

  it("an expired co-treasurer cannot remove a member, even when the removal claims a time inside the role", async () => {
    const t = await town();
    const cotr = await t.admit(await phone());
    const dave = await t.admit(await phone());
    // A seven-day role from T0 + 2 days ends at T0 + 9 days.
    await t.grant(t.community, cotr, "co-treasurer", 7);
    // Log time moves past the end, through the creator's accepted events.
    await advanceLog(t, T0 + 10 * DAY_MS);
    // Written now, claiming T0 + 3 days, which is inside the role. Judged at log time, it is refused.
    const receipt = await appendChecked(
      cotr.space,
      t.removalEvent(cotr.me, dave.me, T0 + 3 * DAY_MS),
    );
    if (!receipt.ok) throw new Error(receipt.error.message);
    await t.sync();
    const rejected = (await t.community.space.view.get(`rejected/${receipt.value.id}`)) as
      | { reason: string }
      | undefined;
    expect(rejected?.reason).toBeDefined();
    expect(await t.membersOf(t.community.space)).toContain(dave.me);
  });

  it("a co-treasurer whose ancestor's role was taken back cannot remove a member", async () => {
    const t = await town();
    const g = await t.admit(await phone());
    const b = await t.admit(await phone());
    const carol = await t.admit(await phone());
    const dave = await t.admit(await phone());
    await t.grant(t.community, g, "co-treasurer");
    await t.grant(g, b, "co-treasurer");
    // While the chain stands, b may remove carol (the control).
    expect(await t.remove(b, carol.me)).toBeUndefined();

    // The creator takes g's role back. b's own grant came through g, so b's standing is gone.
    const revoke = createEvent({
      type: "role.revoked",
      space: t.community.key,
      actor: t.creator.did,
      proof: [],
      claimedAt: T0 + 3 * DAY_MS,
      nonce: hex(randomBytes(16)),
      payload: { role: "co-treasurer", grantee: g.me },
    } as never) as EventEnvelope;
    const revoked = await appendChecked(t.community.space, revoke);
    if (!revoked.ok) throw new Error(revoked.error.message);
    await t.sync();

    expect(await t.remove(b, dave.me, T0 + 4 * DAY_MS)).toBeDefined();
    expect(await t.membersOf(t.community.space)).toContain(dave.me);
  });

  it.each([
    ["a negative time", -1],
    ["a text time", "soon"],
    ["a fractional time", 1.5],
    ["a NaN time", Number.NaN],
  ] as const)(
    "a removal with %s is refused by apply's first check, and removes nobody",
    async (_name, claim) => {
      const auth = new IsoUcanCapabilityAuth();
      const creator = await auth.createIdentity();
      const carol = await auth.createIdentity();
      const seed = {
        [`members/${carol}`]: { invitation: "x", joinedAt: T0 },
        [`indexers/${creator}`]: true,
      };
      const result = await applyRemoval({
        actor: creator,
        creator,
        member: carol,
        seed,
        claimedAt: claim,
      });

      expect(result.reason).toBe(CLAIM_MESSAGE);
      expect(result.removed).toEqual([]);
      expect(result.data.has(`members/${carol}`)).toBe(true);
    },
  );

  it("an invited person who has not joined: an event other than member.joined is refused in apply and changes nothing", async () => {
    const t = await town();
    const bob = await t.admit(await phone());
    const ivy = await phone();
    // Ivy is invited, and has not joined. Invitation admits her as a writer today (story 3.3, shortcut S-3.3-1).
    const invited = await t.community.invite(ivy.did, T0 + 2 * DAY_MS);
    if (!invited.ok) throw new Error(invited.error.message);
    await t.sync();
    const ivySpace = await t.network
      .peer<EventEnvelope>(ivy.did)
      .open(t.community.space.key, communityDefinition(ivy.deps, t.creator.did, t.community.key));
    await t.network.replicate<EventEnvelope>(t.community.space, ivySpace);

    // Ivy tries to remove bob. The record accepts the append; apply refuses its effect.
    const receipt = await appendChecked(ivySpace, t.removalEvent(ivy.did, bob.me));
    expect(receipt.ok).toBe(true);
    await t.network.replicate<EventEnvelope>(t.community.space, ivySpace);
    const rejected = await t.community.space.view.get(
      `rejected/${receipt.ok ? receipt.value.id : ""}`,
    );
    expect(rejected).toMatchObject({ reason: REMOVAL_MESSAGES.not_permitted });
    expect(await t.membersOf(t.community.space)).toContain(bob.me);
  });

  // Not built (story 3.11, shortcut S-3.3-19): the record accepts any event from an invited person who has not joined.
  it.todo(
    "an invited person who has not joined cannot append anything but member.joined (story 3.11)",
  );

  it("two replicas that apply the same removal and the same earlier events in different orders have identical views", async () => {
    const t = await town();
    const bob = await t.admit(await phone());
    const carol = await t.admit(await phone());
    expect(await t.remove(t.community, bob.me)).toBeUndefined();

    // Two more replicas hear the same entries in different orders.
    const r1 = await t.network
      .peer<EventEnvelope>(carol.me)
      .open(
        t.community.space.key,
        communityDefinition(t.creator.deps, t.creator.did, t.community.key),
      );
    const r2 = await t.network
      .peer<EventEnvelope>(bob.me)
      .open(
        t.community.space.key,
        communityDefinition(t.creator.deps, t.creator.did, t.community.key),
      );
    await t.network.replicate<EventEnvelope>(t.community.space, r1);
    await t.network.replicate<EventEnvelope>(carol.space, r1);
    await t.network.replicate<EventEnvelope>(carol.space, r2);
    await t.network.replicate<EventEnvelope>(t.community.space, r2);

    const snapshot = async (space: Space<EventEnvelope>) => {
      await space.update();
      return JSON.stringify(await space.view.list(""));
    };
    const views = [
      await snapshot(t.community.space),
      await snapshot(carol.space),
      await snapshot(r1),
      await snapshot(r2),
    ];
    expect(new Set(views).size).toBe(1);
  });

  it("a removed writer's entries that arrive after the removal from a partitioned replica are dropped on every replica", async () => {
    const t = await town();
    // Bob's DID sorts after the creator's, so the creator's removal is linearised before bob's own entries.
    const bob = await t.admit(await phoneSortingAfter(t.creator.did));
    const carol = await t.admit(await phone());
    await t.grant(t.community, bob, "co-treasurer");
    // Bob is partitioned: he invites someone on his own replica, which nobody else holds yet.
    const offline = await bob.invite((await phone()).did, T0 + 2 * DAY_MS);
    if (!offline.ok) throw new Error(offline.error.message);

    // The creator removes bob. Only the creator and carol exchange entries while bob is partitioned.
    const receipt = await appendChecked(t.community.space, t.removalEvent(t.creator.did, bob.me));
    if (!receipt.ok) throw new Error(receipt.error.message);
    await t.network.replicate<EventEnvelope>(t.community.space, carol.space);

    // Bob's own replica holds the invitation, so the drop below is a real drop and not a missing entry.
    await bob.space.update();
    expect(await bob.space.view.get(`invitations/${offline.value.id}`)).toBeDefined();
    // Bob comes back: his entries reach every replica, and must be dropped there.
    await t.network.replicate<EventEnvelope>(t.community.space, bob.space);
    for (const space of [t.community.space, carol.space, bob.space]) {
      await space.update();
      expect(await space.view.get(`invitations/${offline.value.id}`), space.local).toBeUndefined();
      expect(await t.membersOf(space), space.local).not.toContain(bob.me);
    }
  });

  it("an unused invitation for a removed member does not let them back in", async () => {
    const t = await town();
    const erin = await t.admit(await phone());
    // A fresh invitation is issued to erin, and erin is removed before using it.
    const unused = await t.community.invite(erin.me, T0 + 2 * DAY_MS);
    if (!unused.ok) throw new Error(unused.error.message);
    expect(await t.remove(t.community, erin.me)).toBeUndefined();

    const erinPhone = t.phones.get(erin.me)!;
    const checked = await checkInvitation({
      auth: erinPhone.auth,
      text: unused.value.code,
      me: erin.me,
      now: T0 + 3 * DAY_MS,
      isUsed: async () => false,
      mayPassOn: () => false,
      isCurrentGrant: () => false,
    });
    if (!checked.ok) throw new Error(checked.error.message);
    const joined = await joinCommunity(erinPhone.deps, erin.space, checked.value, T0 + 3 * DAY_MS);
    expect(joined.ok).toBe(false);
    expect(await t.membersOf(t.community.space)).not.toContain(erin.me);
  });
});
