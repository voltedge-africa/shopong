// Roles with limits (story 2.4), tested with simulated phones on one in-memory record. Each phone has
// its own replica and sees the others' events only after `replicate`, as in community.test.ts.
import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import { createMemoryRecordNetwork, type MemoryRecordNetwork } from "@shopong/adapters-memory";
import { createEvent, webCryptoSha512, type EventEnvelope } from "@shopong/events";
import { money, type CapabilityToken, type Did, type Space } from "@shopong/ports";
import { describe, expect, it } from "vite-plus/test";
import {
  DAY_MS,
  INVITATION_MESSAGES,
  NOT_THE_WRITER,
  checkInvitation,
  communityDefinition,
  createCommunity,
  encodeProof,
  formatDay,
  joinCommunity,
  ROLES,
  roleMessage,
  newCommunityKey,
  spaceUri,
  type Community,
  type CommunityDeps,
  type RoleDraft,
} from "./index.js";
import { coTreasurerJoinRecorded, isCurrentGrantIn } from "./roles.js";

const T0 = 1_793_000_000_000;
const RAND = 100; // minor units per rand
const DAYS = (n: number) => n * DAY_MS;
const rand = (n: number) => ({ currency: "ZAR" as const, minor: n * RAND });

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

async function phone() {
  const auth = new IsoUcanCapabilityAuth();
  const did = await auth.createIdentity();
  const deps: CommunityDeps = { auth, sha512: webCryptoSha512, randomBytes };
  return { auth, did, deps };
}

type Phone = Awaited<ReturnType<typeof phone>>;

/** One community on one record: the creator's phone, and everyone admitted to it. */
async function town() {
  const network: MemoryRecordNetwork = createMemoryRecordNetwork();
  const creator = await phone();
  const made = await createCommunity(
    creator.deps,
    network.peer<EventEnvelope>(creator.did),
    "Ntombi Stokvel",
    T0,
  );
  if (!made.ok) throw new Error(made.error.message);
  const community = made.value;
  const phones = new Map<string, Phone>([[creator.did, creator]]);
  const members: Community[] = [community];
  const joinTokens = new Map<string, CapabilityToken>();

  /** Invite a person, have them join on their own phone, and sync. Returns their community. */
  async function admit(p: Phone, now = T0): Promise<Community> {
    phones.set(p.did, p);
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
    joinTokens.set(p.did, checked.value.token);
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

  return { network, creator, community, phones, members, admit, sync, joinTokens };
}

type Town = Awaited<ReturnType<typeof town>>;

/** Give a role on `giver`'s phone, then sync, so `grantee` and the creator see it. */
async function grant(
  t: Town,
  giver: Community,
  grantee: Community,
  role: string,
  options: { limit?: ReturnType<typeof rand>; days?: number } = {},
  now = T0 + DAYS(2),
): Promise<RoleDraft> {
  const granted = await giver.grantRole(grantee.me, role, options, now);
  if (!granted.ok) throw new Error(granted.error.message);
  await t.sync();
  return granted.value;
}

/** The plain reason a give (or a check) is refused. */
async function refusedGiving(
  t: Town,
  giver: Community,
  grantee: Community | Did,
  role: string,
  options: { limit?: ReturnType<typeof rand>; days?: number } = {},
  now = T0 + DAYS(3),
): Promise<string> {
  await t.sync();
  const who = typeof grantee === "string" ? grantee : grantee.me;
  const result = await giver.grantRole(who, role, options, now);
  if (result.ok) throw new Error("expected a refusal");
  return result.error.message;
}

/** A raw event by a writer of the space, with any actor and proof. The reason it was refused, if it was. */
async function raw(
  space: Space<EventEnvelope>,
  event: {
    type: string;
    actor: Did;
    space: string;
    payload: Record<string, unknown>;
    proof: string[];
  },
): Promise<string | undefined> {
  const built = createEvent({
    type: event.type,
    space: event.space,
    actor: event.actor,
    proof: event.proof,
    claimedAt: T0 + DAY_MS,
    nonce: Array.from(randomBytes(16), (b) => b.toString(16).padStart(2, "0")).join(""),
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

/** The phone's auth for a community member, to sign by hand where a test must. */
const authOf = (t: Town, c: Community) => {
  const p = t.phones.get(c.me);
  if (p === undefined) throw new Error("no phone for member");
  return p.auth;
};

describe("giving a role", () => {
  it("records the role, and the person sees it with its end date", async () => {
    const t = await town();
    const driver = await t.admit(await phone());
    const now = T0 + DAYS(2);
    await grant(t, t.community, driver, "driver", {}, now);
    const roles = await driver.roles();
    expect(roles).toHaveLength(1);
    expect(roles[0]?.role).toBe("driver");
    expect(roles[0]?.expiresAt).toBe(now + DAYS(30));
  });

  it("accepts 7, 30 and 90 days, refuses any other length, and defaults to 30", async () => {
    const t = await town();
    const driver = await t.admit(await phone());
    expect(await refusedGiving(t, t.community, driver, "driver", { days: 14 })).toBe(
      "Pick 7, 30 or 90 days.",
    );
    const ninety = await grant(t, t.community, driver, "driver", { days: 90 }, T0);
    expect(ninety.expiresAt).toBe(T0 + DAYS(90));
  });

  it("a second grant of the same role replaces the first", async () => {
    const t = await town();
    const driver = await t.admit(await phone());
    await grant(t, t.community, driver, "driver", { days: 7 }, T0);
    await grant(t, t.community, driver, "driver", { days: 90 }, T0);
    expect((await driver.roles()).map((r) => r.expiresAt)).toEqual([T0 + DAYS(90)]);
  });

  it("refuses a stranger, oneself, a missing or unwanted limit", async () => {
    const t = await town();
    const cotr = await t.admit(await phone());
    const stranger = await phone();
    expect(await refusedGiving(t, t.community, stranger.did, "driver")).toBe(
      "Invite them to the community first.",
    );
    expect(await refusedGiving(t, t.community, t.creator.did, "driver")).toBe(
      "You already hold every role.",
    );
    await grant(t, t.community, cotr, "co-treasurer", { limit: rand(1000) }, T0);
    expect(await refusedGiving(t, cotr, cotr.me, "driver", {}, T0 + DAYS(3))).toBe(
      "You can't give a role to yourself.",
    );
    expect(await refusedGiving(t, t.community, cotr, "co-treasurer", {}, T0)).toBe(
      "Set a limit for this role.",
    );
    expect(await refusedGiving(t, t.community, cotr, "driver", { limit: rand(1) }, T0)).toBe(
      "This role has no limit.",
    );
  });
});

describe("what can I do?", () => {
  it("allows an action inside the limit, and gives the plain reason above it", async () => {
    const t = await town();
    const cotr = await t.admit(await phone());
    await grant(t, t.community, cotr, "co-treasurer", { limit: rand(1000) }, T0);
    const now = T0 + DAYS(3);
    expect(
      (await cotr.checkAction({ ability: "payment/approve", amount: rand(800) }, now)).ok,
    ).toBe(true);
    const above = await cotr.checkAction({ ability: "payment/approve", amount: rand(1500) }, now);
    expect(above.ok).toBe(false);
    if (!above.ok) expect(above.error.message).toBe("That is above your limit of R1000.");
  });

  it("refuses an action the role does not cover", async () => {
    const t = await town();
    const driver = await t.admit(await phone());
    await grant(t, t.community, driver, "driver", {}, T0);
    const now = T0 + DAYS(3);
    const paying = await driver.checkAction({ ability: "payment/approve", amount: rand(1) }, now);
    expect(paying.ok).toBe(false);
    if (!paying.ok) expect(paying.error.message).toBe("Your role doesn't cover that.");
    expect((await driver.checkAction({ ability: "delivery/confirm" }, now)).ok).toBe(true);
  });

  it("refuses once the role has ended, and names the day", async () => {
    const t = await town();
    const driver = await t.admit(await phone());
    const granted = await grant(t, t.community, driver, "driver", { days: 7 }, T0);
    expect(
      (await driver.checkAction({ ability: "delivery/confirm" }, granted.expiresAt - 1)).ok,
    ).toBe(true);
    const after = await driver.checkAction({ ability: "delivery/confirm" }, granted.expiresAt);
    expect(after.ok).toBe(false);
    if (!after.ok)
      expect(after.error.message).toBe(`Your role ended on ${formatDay(granted.expiresAt)}.`);
  });

  it("asks how much for the limited ability", async () => {
    const t = await town();
    const cotr = await t.admit(await phone());
    await grant(t, t.community, cotr, "co-treasurer", { limit: rand(1000) }, T0);
    const none = await cotr.checkAction({ ability: "payment/approve" }, T0 + DAYS(3));
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.error.message).toBe("Say how much.");
  });
});

describe("inviting through a co-treasurer", () => {
  it("refuses member/invite when the co-treasurer's role came through another co-treasurer", async () => {
    const t = await town();
    const first = await t.admit(await phone());
    const second = await t.admit(await phone());
    await grant(t, t.community, first, "co-treasurer", { limit: rand(1000) }, T0);
    expect((await first.checkAction({ ability: "member/invite" }, T0 + DAYS(3))).ok).toBe(true);
    await grant(t, first, second, "co-treasurer", { limit: rand(500), days: 7 }, T0 + DAYS(3));
    const refused = await second.checkAction({ ability: "member/invite" }, T0 + DAYS(4));
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toBe("Your role doesn't cover that.");
  });
});

describe("passing a role on", () => {
  it("accepts a lower limit, and the new holder is held to it", async () => {
    const t = await town();
    const first = await t.admit(await phone());
    const second = await t.admit(await phone());
    await grant(t, t.community, first, "co-treasurer", { limit: rand(1000) }, T0);
    await grant(t, first, second, "co-treasurer", { limit: rand(500), days: 7 }, T0 + DAYS(3));
    const now = T0 + DAYS(4);
    const over = await second.checkAction({ ability: "payment/approve", amount: rand(600) }, now);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error.message).toBe("That is above your limit of R500.");
    expect(
      (await second.checkAction({ ability: "payment/approve", amount: rand(400) }, now)).ok,
    ).toBe(true);
  });

  it("refuses a higher limit at once, and a longer time", async () => {
    const t = await town();
    const first = await t.admit(await phone());
    const second = await t.admit(await phone());
    await grant(t, t.community, first, "co-treasurer", { limit: rand(1000), days: 7 }, T0);
    expect(
      await refusedGiving(t, first, second, "co-treasurer", { limit: rand(2000) }, T0 + DAYS(1)),
    ).toBe("You can't give more than you have.");
    expect(
      await refusedGiving(
        t,
        first,
        second,
        "co-treasurer",
        { limit: rand(500), days: 30 },
        T0 + DAYS(1),
      ),
    ).toBe("You can't give more than you have.");
  });

  it("refuses a holder whose role has ended, and names the day", async () => {
    const t = await town();
    const first = await t.admit(await phone());
    const second = await t.admit(await phone());
    const granted = await grant(
      t,
      t.community,
      first,
      "co-treasurer",
      { limit: rand(1000), days: 7 },
      T0,
    );
    expect(
      await refusedGiving(
        t,
        first,
        second,
        "co-treasurer",
        { limit: rand(100) },
        granted.expiresAt + DAY_MS,
      ),
    ).toBe(`Your role ended on ${formatDay(granted.expiresAt)}.`);
  });

  it("refuses a plain member, who may not give roles at all", async () => {
    const t = await town();
    const member = await t.admit(await phone());
    const other = await t.admit(await phone());
    expect(await refusedGiving(t, member, other, "driver", {}, T0 + DAYS(3))).toBe(
      "You can't give roles in this community.",
    );
  });

  it("refuses a role the holder does not hold, even when they hold another", async () => {
    const t = await town();
    const cotr = await t.admit(await phone());
    const driver = await t.admit(await phone());
    await grant(t, t.community, cotr, "co-treasurer", { limit: rand(1000) }, T0);
    expect(await refusedGiving(t, cotr, driver, "driver", {}, T0 + DAYS(3))).toBe(
      "You can't give more than you have.",
    );
  });
});

describe("invitations passed on by a co-treasurer", () => {
  it("a co-treasurer invites a person, who joins, and the invitation lasts no longer than the role", async () => {
    const t = await town();
    const cotr = await t.admit(await phone());
    const role = await grant(
      t,
      t.community,
      cotr,
      "co-treasurer",
      { limit: rand(1000), days: 7 },
      T0,
    );
    const newcomer = await phone();
    const invited = await cotr.invite(newcomer.did, T0 + DAYS(1));
    if (!invited.ok) throw new Error(invited.error.message);
    expect(invited.value.expiresAt).toBeLessThanOrEqual(role.expiresAt);
    await t.sync();

    const space = await t.network
      .peer<EventEnvelope>(newcomer.did)
      .open(
        t.community.space.key,
        communityDefinition(newcomer.deps, t.creator.did, t.community.key),
      );
    await t.network.replicate<EventEnvelope>(t.community.space, space);
    const checked = await checkInvitation({
      auth: newcomer.auth,
      text: invited.value.code,
      me: newcomer.did,
      now: T0 + DAYS(1),
      mayPassOn: (inviter, parentId) =>
        coTreasurerJoinRecorded(space.view, inviter, parentId, T0 + DAYS(1)),
      isCurrentGrant: (holder, id) => isCurrentGrantIn(space.view, holder, id),
    });
    if (!checked.ok) throw new Error(checked.error.message);
    const joined = await joinCommunity(newcomer.deps, space, checked.value, T0 + DAYS(1));
    expect(joined.ok).toBe(true);
    await t.network.replicate<EventEnvelope>(t.community.space, space);
    expect((await t.community.members()).map((m) => m.did)).toContain(newcomer.did);
  });

  it("a plain member who passes their own invitation on is refused (S-2.3-24)", async () => {
    const t = await town();
    const member = await t.admit(await phone());
    const stranger = await phone();
    const passed = await authOf(t, member).issue({
      issuer: member.me,
      audience: stranger.did,
      capabilities: [{ with: spaceUri(t.community.key), can: "member/join" }],
      expiresAt: T0 + DAYS(5),
      proofs: [t.joinTokens.get(member.me) as CapabilityToken],
    });
    if (!passed.ok) throw new Error(passed.error.message);
    const memberSpace = await t.network
      .peer<EventEnvelope>(member.me)
      .open(
        t.community.space.key,
        communityDefinition(t.phones.get(member.me)!.deps, t.creator.did, t.community.key),
      );
    await t.network.replicate<EventEnvelope>(t.community.space, memberSpace);
    const checked = await checkInvitation({
      auth: stranger.auth,
      text: `shopong://join?space=${t.community.key}&creator=${encodeURIComponent(t.creator.did)}&invitation=${encodeURIComponent(passed.value)}`,
      me: stranger.did,
      now: T0 + DAYS(2),
      mayPassOn: (inviter, parentId) =>
        coTreasurerJoinRecorded(memberSpace.view, inviter, parentId, T0 + DAYS(2)),
      isCurrentGrant: (holder, id) => isCurrentGrantIn(memberSpace.view, holder, id),
    });
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.error.message).toBe(INVITATION_MESSAGES.unreadable);
  });

  it("a co-treasurer may pass on only the grant from their role, not their own invitation", async () => {
    const t = await town();
    const cotr = await t.admit(await phone());
    await grant(t, t.community, cotr, "co-treasurer", { limit: rand(1000) }, T0);
    const stranger = await phone();
    const passed = await authOf(t, cotr).issue({
      issuer: cotr.me,
      audience: stranger.did,
      capabilities: [{ with: spaceUri(t.community.key), can: "member/join" }],
      expiresAt: T0 + DAYS(5),
      proofs: [t.joinTokens.get(cotr.me) as CapabilityToken],
    });
    if (!passed.ok) throw new Error(passed.error.message);
    const checked = await checkInvitation({
      auth: stranger.auth,
      text: `shopong://join?space=${t.community.key}&creator=${encodeURIComponent(t.creator.did)}&invitation=${encodeURIComponent(passed.value)}`,
      me: stranger.did,
      now: T0 + DAYS(2),
      mayPassOn: (inviter, parentId) =>
        coTreasurerJoinRecorded(t.community.space.view, inviter, parentId, T0 + DAYS(2)),
      isCurrentGrant: (holder, id) => isCurrentGrantIn(t.community.space.view, holder, id),
    });
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.error.message).toBe(INVITATION_MESSAGES.unreadable);
  });

  it("apply refuses a join that uses a member's passed-on invitation", async () => {
    const t = await town();
    const member = await t.admit(await phone());
    const stranger = await phone();
    const invited = await t.community.invite(stranger.did, T0);
    if (!invited.ok) throw new Error(invited.error.message);
    const passed = await authOf(t, member).issue({
      issuer: member.me,
      audience: stranger.did,
      capabilities: [{ with: spaceUri(t.community.key), can: "member/join" }],
      expiresAt: T0 + DAYS(5),
      proofs: [t.joinTokens.get(member.me) as CapabilityToken],
    });
    if (!passed.ok) throw new Error(passed.error.message);
    const strangerSpace = await t.network
      .peer<EventEnvelope>(stranger.did)
      .open(
        t.community.space.key,
        communityDefinition(stranger.deps, t.creator.did, t.community.key),
      );
    await t.network.replicate<EventEnvelope>(t.community.space, strangerSpace);
    const reason = await raw(strangerSpace, {
      type: "member.joined",
      actor: stranger.did,
      space: t.community.key,
      payload: { invitation: await stranger.auth.tokenId(passed.value) },
      proof: [encodeProof(passed.value)],
    });
    expect(reason).toBe(INVITATION_MESSAGES.unreadable);
  });
});

describe("apply refuses a forged or unreadable role", () => {
  it("refuses a role.granted written by someone who is not its actor", async () => {
    const t = await town();
    const member = await t.admit(await phone());
    const memberSpace = await t.network
      .peer<EventEnvelope>(member.me)
      .open(
        t.community.space.key,
        communityDefinition(t.phones.get(member.me)!.deps, t.creator.did, t.community.key),
      );
    await t.network.replicate<EventEnvelope>(t.community.space, memberSpace);
    const reason = await raw(memberSpace, {
      type: "role.granted",
      actor: t.creator.did,
      space: t.community.key,
      payload: { role: "driver", grantee: member.me, expiresAt: T0 + DAYS(30) },
      proof: [],
    });
    expect(reason).toBe(NOT_THE_WRITER);
  });

  it("refuses a role whose token was made for another community", async () => {
    const t = await town();
    const driver = await t.admit(await phone());
    const token = await t.creator.auth.issue({
      issuer: t.creator.did,
      audience: driver.me,
      capabilities: [{ with: spaceUri(newCommunityKey(randomBytes)), can: "delivery/confirm" }],
      notBefore: T0,
      expiresAt: T0 + DAYS(30),
    });
    if (!token.ok) throw new Error(token.error.message);
    const reason = await raw(t.community.space, {
      type: "role.granted",
      actor: t.creator.did,
      space: t.community.key,
      payload: { role: "driver", grantee: driver.me, expiresAt: T0 + DAYS(30) },
      proof: [encodeProof(token.value)],
    });
    expect(reason).toBe(roleMessage("unreadable"));
  });

  it("refuses a role whose token has been tampered with", async () => {
    const t = await town();
    const driver = await t.admit(await phone());
    const token = await t.creator.auth.issue({
      issuer: t.creator.did,
      audience: driver.me,
      capabilities: [{ with: spaceUri(t.community.key), can: "delivery/confirm" }],
      notBefore: T0,
      expiresAt: T0 + DAYS(30),
    });
    if (!token.ok) throw new Error(token.error.message);
    const at = Math.floor(token.value.length / 2);
    const tampered = `${token.value.slice(0, at)}${token.value[at] === "A" ? "B" : "A"}${token.value.slice(at + 1)}`;
    const reason = await raw(t.community.space, {
      type: "role.granted",
      actor: t.creator.did,
      space: t.community.key,
      payload: { role: "driver", grantee: driver.me, expiresAt: T0 + DAYS(30) },
      proof: [encodeProof(tampered)],
    });
    expect(reason).toBe(roleMessage("unreadable"));
  });

  it("refuses a member's invitation presented as a driver's role", async () => {
    const t = await town();
    const member = await t.admit(await phone());
    const reason = await raw(t.community.space, {
      type: "role.granted",
      actor: t.creator.did,
      space: t.community.key,
      payload: { role: "driver", grantee: member.me, expiresAt: T0 + DAYS(30) },
      proof: [encodeProof(t.joinTokens.get(member.me) as CapabilityToken)],
    });
    expect(reason).toBe(roleMessage("unreadable"));
  });
  it("refuses a role whose stated end differs from its tokens' end, and records nothing", async () => {
    const t = await town();
    const driver = await t.admit(await phone());
    const token = await t.creator.auth.issue({
      issuer: t.creator.did,
      audience: driver.me,
      capabilities: [{ with: spaceUri(t.community.key), can: "delivery/confirm" }],
      notBefore: T0,
      expiresAt: T0 + DAYS(30),
    });
    if (!token.ok) throw new Error(token.error.message);
    const reason = await raw(t.community.space, {
      type: "role.granted",
      actor: t.creator.did,
      space: t.community.key,
      payload: { role: "driver", grantee: driver.me, expiresAt: T0 + DAYS(31) },
      proof: [encodeProof(token.value)],
    });
    expect(reason).toBe(roleMessage("unreadable"));
    expect(await t.community.space.view.get(`roles/${driver.me}/driver`)).toBeUndefined();
  });

  it("refuses a role whose tokens were issued by someone other than its actor, and records nothing", async () => {
    const t = await town();
    const honest = await t.admit(await phone());
    const driver = await t.admit(await phone());
    const token = await t.creator.auth.issue({
      issuer: t.creator.did,
      audience: driver.me,
      capabilities: [{ with: spaceUri(t.community.key), can: "delivery/confirm" }],
      notBefore: T0,
      expiresAt: T0 + DAYS(30),
    });
    if (!token.ok) throw new Error(token.error.message);
    const honestSpace = await t.network
      .peer<EventEnvelope>(honest.me)
      .open(
        t.community.space.key,
        communityDefinition(t.phones.get(honest.me)!.deps, t.creator.did, t.community.key),
      );
    await t.network.replicate<EventEnvelope>(t.community.space, honestSpace);
    const reason = await raw(honestSpace, {
      type: "role.granted",
      actor: honest.me,
      space: t.community.key,
      payload: { role: "driver", grantee: driver.me, expiresAt: T0 + DAYS(30) },
      proof: [encodeProof(token.value)],
    });
    expect(reason).toBe(roleMessage("unreadable"));
    expect(await t.community.space.view.get(`roles/${driver.me}/driver`)).toBeUndefined();
  });

  it("refuses a co-treasurer role whose limited ability has no ceiling, and records nothing", async () => {
    const t = await town();
    const cotr = await t.admit(await phone());
    const proof: string[] = [];
    for (const can of ["payment/approve", "member/invite", "member/join"]) {
      const token = await t.creator.auth.issue({
        issuer: t.creator.did,
        audience: cotr.me,
        capabilities: [{ with: spaceUri(t.community.key), can }],
        notBefore: T0,
        expiresAt: T0 + DAYS(30),
      });
      if (!token.ok) throw new Error(token.error.message);
      proof.push(encodeProof(token.value));
    }
    const reason = await raw(t.community.space, {
      type: "role.granted",
      actor: t.creator.did,
      space: t.community.key,
      payload: { role: "co-treasurer", grantee: cotr.me, expiresAt: T0 + DAYS(30) },
      proof,
    });
    expect(reason).toBe(roleMessage("unreadable"));
    expect(await t.community.space.view.get(`roles/${cotr.me}/co-treasurer`)).toBeUndefined();
  });

  it("refuses a driver role whose ability carries a ceiling, and records nothing", async () => {
    const t = await town();
    const driver = await t.admit(await phone());
    const token = await t.creator.auth.issue({
      issuer: t.creator.did,
      audience: driver.me,
      capabilities: [
        {
          with: spaceUri(t.community.key),
          can: "delivery/confirm",
          ceiling: { currency: "ZAR", minor: 100 * RAND },
        },
      ],
      notBefore: T0,
      expiresAt: T0 + DAYS(30),
    });
    if (!token.ok) throw new Error(token.error.message);
    const reason = await raw(t.community.space, {
      type: "role.granted",
      actor: t.creator.did,
      space: t.community.key,
      payload: { role: "driver", grantee: driver.me, expiresAt: T0 + DAYS(30) },
      proof: [encodeProof(token.value)],
    });
    expect(reason).toBe(roleMessage("unreadable"));
    expect(await t.community.space.view.get(`roles/${driver.me}/driver`)).toBeUndefined();
  });
});

describe("replicas agree on roles", () => {
  it("a late replica sees the same roles as the creator", async () => {
    const t = await town();
    const driver = await t.admit(await phone());
    await grant(t, t.community, driver, "driver", {}, T0);
    const late = await phone();
    const lateSpace = await t.network
      .peer<EventEnvelope>(late.did)
      .open(t.community.space.key, communityDefinition(late.deps, t.creator.did, t.community.key));
    await t.network.replicate<EventEnvelope>(t.community.space, lateSpace);
    await lateSpace.update();
    const creatorRoles = await t.community.space.view.list("roles/");
    expect(creatorRoles).toHaveLength(1);
    expect(await lateSpace.view.list("roles/")).toEqual(creatorRoles);
  });
});

describe("who may replace a role, and proofs missing or changed in the record (story 2.5)", () => {
  it("only the giver or the creator may replace a role; another co-treasurer is refused", async () => {
    const t = await town();
    const first = await t.admit(await phone());
    const second = await t.admit(await phone());
    const third = await t.admit(await phone());
    await grant(t, t.community, first, "co-treasurer", { limit: rand(1000) }, T0);
    await grant(t, t.community, second, "co-treasurer", { limit: rand(1000) }, T0);
    await grant(t, first, third, "co-treasurer", { limit: rand(500), days: 7 }, T0 + DAYS(1));
    const reason = await refusedGiving(
      t,
      second,
      third,
      "co-treasurer",
      { limit: rand(400), days: 7 },
      T0 + DAYS(2),
    );
    expect(reason).toBe("Only the person who gave this role, or the creator, can replace it.");
    // The original giver may replace it, and then the creator may replace it (who gave it is now the creator).
    await grant(t, first, third, "co-treasurer", { limit: rand(200), days: 7 }, T0 + DAYS(3));
    await grant(t, t.community, third, "co-treasurer", { limit: rand(300), days: 7 }, T0 + DAYS(4));
  });

  it("refuses a role.granted with no tokens at all, and records nothing", async () => {
    const t = await town();
    const driver = await t.admit(await phone());
    const reason = await raw(t.community.space, {
      type: "role.granted",
      actor: t.creator.did,
      space: t.community.key,
      payload: { role: "driver", grantee: driver.me, expiresAt: T0 + DAYS(30) },
      proof: [],
    });
    expect(reason).toBe(roleMessage("unreadable"));
    expect(await driver.roles()).toHaveLength(0);
  });

  it("refuses a join whose invitation proof was changed, and records the reason", async () => {
    const t = await town();
    const invitee = await phone();
    const invited = await t.community.invite(invitee.did, T0);
    if (!invited.ok) throw new Error(invited.error.message);
    const space = await t.network
      .peer<EventEnvelope>(invitee.did)
      .open(
        t.community.space.key,
        communityDefinition(invitee.deps, t.creator.did, t.community.key),
      );
    await t.network.replicate<EventEnvelope>(t.community.space, space);
    const token = invited.value.token;
    const at = Math.floor(token.length / 2);
    const tampered = `${token.slice(0, at)}${token[at] === "A" ? "B" : "A"}${token.slice(at + 1)}`;
    const reason = await raw(space, {
      type: "member.joined",
      actor: invitee.did,
      space: t.community.key,
      payload: { invitation: invited.value.id },
      proof: [encodeProof(tampered)],
    });
    expect(reason).toBe(INVITATION_MESSAGES.unreadable);
  });
});

describe("a grant built on a grant the creator has since replaced (review finding 1)", () => {
  it("is refused on the device and in apply, once the creator re-grants the ancestor", async () => {
    const t = await town();
    const g = await t.admit(await phone());
    const a = await t.admit(await phone());
    await grant(t, t.community, g, "co-treasurer", { limit: rand(10000), days: 90 }, T0);
    const oldGrants = (await g.roles())[0]?.grants ?? [];
    // G gives A R5,000 from the grant the creator gave G.
    await grant(t, g, a, "co-treasurer", { limit: rand(5000), days: 7 }, T0 + DAYS(1));
    const before = await a.checkAction(
      { ability: "payment/approve", amount: rand(5000) },
      T0 + DAYS(2),
    );
    expect(before.ok).toBe(true);

    // The creator re-grants G at R100. The old grant is no longer in G's record.
    await grant(t, t.community, g, "co-treasurer", { limit: rand(100), days: 90 }, T0 + DAYS(2));
    const device = await a.checkAction(
      { ability: "payment/approve", amount: rand(5000) },
      T0 + DAYS(3),
    );
    expect(device.ok).toBe(false);
    if (!device.ok) expect(device.error.message).toBe("Your role doesn't cover that.");

    // Apply: G builds a co-treasurer role for B from the replaced grant, and the record must refuse it.
    const b = await t.admit(await phone());
    const from = authOf(t, g);
    const tokens: CapabilityToken[] = [];
    for (const ability of ROLES["co-treasurer"].abilities) {
      const parent = oldGrants.find((grant) => grant.ability === ability);
      if (parent === undefined) throw new Error("no old grant");
      const issued = await from.issue({
        issuer: g.me,
        audience: b.me,
        capabilities: [
          {
            with: spaceUri(t.community.key),
            can: ability,
            ...(ability === "payment/approve" ? { ceiling: money("ZAR", 5000_00) } : {}),
          },
        ],
        notBefore: T0,
        expiresAt: T0 + DAYS(10),
        proofs: [parent.token],
      });
      if (!issued.ok) throw new Error(issued.error.message);
      tokens.push(issued.value);
    }
    const reason = await raw(g.space, {
      type: "role.granted",
      actor: g.me,
      space: t.community.key,
      payload: { role: "co-treasurer", grantee: b.me, expiresAt: T0 + DAYS(10) },
      proof: tokens.map((token) => encodeProof(token)),
    });
    expect(reason).toBe("You can't give more than you have.");
  });

  it("the device and apply checks run with the network trapped", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("network read during a record or device check");
    }) as typeof fetch;
    try {
      const t = await town();
      const driver = await t.admit(await phone());
      await grant(t, t.community, driver, "driver", {}, T0);
      expect((await driver.checkAction({ ability: "delivery/confirm" }, T0 + DAYS(1))).ok).toBe(
        true,
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
