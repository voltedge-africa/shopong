import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import { createMemoryRecordNetwork } from "@shopong/adapters-memory";
import {
  createEvent,
  PERSONAL_DATA_MESSAGE,
  webCryptoSha512,
  type EventEnvelope,
} from "@shopong/events";
import { money, type Did, type Space } from "@shopong/ports";
import { describe, expect, it } from "vite-plus/test";
import {
  DAY_MS,
  INVITATION_DAYS,
  INVITATION_MESSAGES,
  NOT_THE_WRITER,
  EMPTY_NAME_MESSAGE,
  NAMING_MESSAGES,
  holdersOf,
  checkInvitation,
  communityDefinition,
  createCommunity,
  encodeProof,
  newCommunityKey,
  spaceUri,
  isCommunityKey,
  issueInvitation,
  joinCommunity,
  parseInvitationText,
  type CommunityDeps,
} from "./index.js";

const T0 = 1_793_000_000_000;

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

async function phone() {
  const auth = new IsoUcanCapabilityAuth();
  const did = await auth.createIdentity();
  const deps: CommunityDeps = { auth, sha512: webCryptoSha512, randomBytes };
  return { auth, did, deps };
}

/** A treasurer with a community, and a newcomer who has the record but is not yet invited. */
async function world() {
  const network = createMemoryRecordNetwork();
  const treasurer = await phone();
  const newcomer = await phone();
  const made = await createCommunity(
    treasurer.deps,
    network.peer<EventEnvelope>(treasurer.did),
    "Ntombi Stokvel",
    T0,
  );
  if (!made.ok) throw new Error(made.error.message);
  const community = made.value;
  const newcomerSpace = await network
    .peer<EventEnvelope>(newcomer.did)
    .open(community.space.key, communityDefinition(newcomer.deps, treasurer.did, community.key));
  const sync = () => network.replicate<EventEnvelope>(community.space, newcomerSpace);
  return { network, treasurer, newcomer, community, newcomerSpace, sync };
}

const isUsedIn = (space: Space<EventEnvelope>) => async (id: string) => {
  await space.update();
  return (await space.view.get(`joined/${id}`)) !== undefined;
};

describe("create", () => {
  it("makes the creator its only member", async () => {
    const w = await world();
    expect(isCommunityKey(w.community.key)).toBe(true);
    expect((await w.community.members()).map((m) => m.did)).toEqual([w.treasurer.did]);
  });

  it("refuses a blank name", async () => {
    const t = await phone();
    const made = await createCommunity(
      t.deps,
      createMemoryRecordNetwork().peer<EventEnvelope>(t.did),
      "   ",
      T0,
    );
    expect(made.ok).toBe(false);
    if (!made.ok) expect(made.error.message).toBe(EMPTY_NAME_MESSAGE);
  });
});

describe("invite and join", () => {
  it("joins offline with a valid invitation and shows as a member on both phones", async () => {
    const w = await world();
    const invitation = await w.community.invite(w.newcomer.did, T0);
    if (!invitation.ok) throw new Error(invitation.error.message);
    expect(invitation.value.code).toBe(invitation.value.link);
    expect(invitation.value.expiresAt).toBe(T0 + INVITATION_DAYS * DAY_MS);
    await w.sync();

    const checked = await checkInvitation({
      auth: w.newcomer.auth,
      text: invitation.value.code,
      me: w.newcomer.did,
      now: T0 + DAY_MS,
      isUsed: isUsedIn(w.newcomerSpace),
    });
    if (!checked.ok) throw new Error(checked.error.message);
    const joined = await joinCommunity(
      w.newcomer.deps,
      w.newcomerSpace,
      checked.value,
      T0 + DAY_MS,
    );
    expect(joined.ok).toBe(true);
    await w.sync();
    const dids = (await w.community.members()).map((m) => m.did).sort();
    expect(dids).toEqual([w.treasurer.did, w.newcomer.did].sort());
  });

  it("works with a real clock time that is not a whole second", async () => {
    const w = await world();
    const now = 1_793_000_000_123;
    const invitation = await w.community.invite(w.newcomer.did, now);
    if (!invitation.ok) throw new Error(invitation.error.message);
    expect(invitation.value.expiresAt).toBe(1_793_000_000_000 + INVITATION_DAYS * DAY_MS);
    await w.sync();
    const checked = await checkInvitation({
      auth: w.newcomer.auth,
      text: invitation.value.code,
      me: w.newcomer.did,
      now: now + 1000,
      isUsed: isUsedIn(w.newcomerSpace),
    });
    if (!checked.ok) throw new Error(checked.error.message);
    const joined = await joinCommunity(w.newcomer.deps, w.newcomerSpace, checked.value, now + 1000);
    expect(joined.ok).toBe(true);
    await w.sync();
    expect((await w.community.members()).length).toBe(2);
  });

  it("refuses a bad DID", async () => {
    const w = await world();
    const bad = await w.community.invite("not a did", T0);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.message).toBe(INVITATION_MESSAGES.bad_invitee);
  });

  it("refuses an expired invitation", async () => {
    const w = await world();
    const inv = await issueInvitation({
      auth: w.treasurer.auth,
      creator: w.treasurer.did,
      spaceKey: w.community.key,
      invitee: w.newcomer.did,
      now: T0,
    });
    if (!inv.ok) throw new Error(inv.error.message);
    const late = await checkInvitation({
      auth: w.newcomer.auth,
      text: inv.value.code,
      me: w.newcomer.did,
      now: T0 + INVITATION_DAYS * DAY_MS,
    });
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.error.message).toBe(INVITATION_MESSAGES.expired);
    const justInTime = await checkInvitation({
      auth: w.newcomer.auth,
      text: inv.value.code,
      me: w.newcomer.did,
      now: T0 + INVITATION_DAYS * DAY_MS - 1,
    });
    expect(justInTime.ok).toBe(true);
  });

  it("refuses an invitation meant for someone else", async () => {
    const w = await world();
    const other = await phone();
    const inv = await w.community.invite(other.did, T0);
    if (!inv.ok) throw new Error(inv.error.message);
    const checked = await checkInvitation({
      auth: w.newcomer.auth,
      text: inv.value.code,
      me: w.newcomer.did,
      now: T0,
    });
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.error.message).toBe(INVITATION_MESSAGES.someone_else);
  });

  it("refuses a reused invitation, on the phone and in the record", async () => {
    const w = await world();
    const inv = await w.community.invite(w.newcomer.did, T0);
    if (!inv.ok) throw new Error(inv.error.message);
    await w.sync();
    const request = {
      auth: w.newcomer.auth,
      text: inv.value.code,
      me: w.newcomer.did,
      now: T0 + 1000,
      isUsed: isUsedIn(w.newcomerSpace),
    };
    const first = await checkInvitation(request);
    if (!first.ok) throw new Error(first.error.message);
    expect((await joinCommunity(w.newcomer.deps, w.newcomerSpace, first.value, T0 + 1000)).ok).toBe(
      true,
    );

    const again = await checkInvitation(request);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.message).toBe(INVITATION_MESSAGES.already_used);

    // Bypassing the phone check: apply still refuses the second event.
    const second = await joinCommunity(w.newcomer.deps, w.newcomerSpace, first.value, T0 + 2000);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.message).toBe(INVITATION_MESSAGES.already_used);
    expect((await w.community.members()).length).toBe(1);
    await w.sync();
    expect((await w.community.members()).length).toBe(2);
  });

  it("refuses tampered, wrong-community and garbage text", async () => {
    const w = await world();
    const inv = await w.community.invite(w.newcomer.did, T0);
    if (!inv.ok) throw new Error(inv.error.message);
    const check = (text: string) =>
      checkInvitation({ auth: w.newcomer.auth, text, me: w.newcomer.did, now: T0 });
    const parts = parseInvitationText(inv.value.code);
    if (parts === undefined) throw new Error("link did not parse");
    const tampered =
      inv.value.code.slice(0, -4) + (inv.value.code.endsWith("AAAA") ? "BBBB" : "AAAA");
    const otherKey = inv.value.code.replace(parts.spaceKey, "0".repeat(64));
    const otherCreator = inv.value.code.replace(
      encodeURIComponent(parts.creator),
      encodeURIComponent(w.newcomer.did),
    );
    for (const text of [tampered, otherKey, otherCreator, "hello", "", "?%E0%A4%A"]) {
      const result = await check(text);
      expect(result.ok, text).toBe(false);
      if (!result.ok) expect(result.error.message, text).toBe(INVITATION_MESSAGES.unreadable);
    }
    // A link that names the community but has no proof in it is a missing proof.
    const noProof = await check("shopong://join?space=1");
    expect(noProof.ok ? undefined : noProof.error.message).toBe(INVITATION_MESSAGES.missing_proof);
  });

  it("asks for an identity first", async () => {
    const w = await world();
    const result = await checkInvitation({
      auth: w.newcomer.auth,
      text: "anything",
      me: undefined,
      now: T0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe(INVITATION_MESSAGES.no_identity);
  });
});

describe("apply", () => {
  // A raw event, appended by `space`'s own writer, with any `actor` the test wants to claim. This is
  // what a hostile or buggy writer can do; the community helpers never write one.
  async function raw(
    space: Space<EventEnvelope>,
    event: {
      type: "member.invited" | "member.joined";
      actor: Did;
      payload: Record<string, unknown>;
      proof?: string[];
      at?: number;
      space?: string;
    },
  ) {
    const built = createEvent({
      type: event.type,
      space: event.space,
      actor: event.actor,
      proof: event.proof ?? [],
      claimedAt: event.at ?? T0,
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
    return { reason };
  }

  /** A community where the newcomer was invited (so is an admitted writer) and the replicas are in sync. */
  async function invitedWorld() {
    const w = await world();
    const inv = await w.community.invite(w.newcomer.did, T0);
    if (!inv.ok) throw new Error(inv.error.message);
    await w.sync();
    return { ...w, inv: inv.value };
  }

  const join = (w: Awaited<ReturnType<typeof invitedWorld>>) => ({
    type: "member.joined" as const,
    actor: w.newcomer.did,
    space: w.community.key,
  });

  it("refuses a member.invited that names the creator but was written by an invited writer", async () => {
    const w = await invitedWorld();
    const stranger = await phone();
    const result = await raw(w.newcomerSpace, {
      type: "member.invited",
      actor: w.treasurer.did,
      space: w.community.key,
      payload: { invitation: "forged", invitee: stranger.did, expiresAt: T0 + DAY_MS },
    });
    expect(result.reason).toBe(NOT_THE_WRITER);
    expect(await w.newcomerSpace.view.get("invitations/forged")).toBeUndefined();
    expect(await w.newcomerSpace.writers()).not.toContain(stranger.did);
  });

  it("refuses a member.joined that names someone else, even with that person's real token", async () => {
    const w = await invitedWorld();
    const victim = await phone();
    const victimInvite = await w.community.invite(victim.did, T0);
    if (!victimInvite.ok) throw new Error(victimInvite.error.message);
    await w.sync();
    const result = await raw(w.newcomerSpace, {
      type: "member.joined",
      actor: victim.did,
      space: w.community.key,
      proof: [encodeProof(victimInvite.value.token)],
      payload: { invitation: victimInvite.value.id },
    });
    expect(result.reason).toBe(NOT_THE_WRITER);
    expect(await w.newcomerSpace.view.get(`members/${victim.did}`)).toBeUndefined();
    expect(await w.newcomerSpace.view.get(`joined/${victimInvite.value.id}`)).toBeUndefined();
  });

  it("refuses someone else's token when an honest writer presents it", async () => {
    const w = await invitedWorld();
    const victim = await phone();
    const victimInvite = await w.community.invite(victim.did, T0);
    if (!victimInvite.ok) throw new Error(victimInvite.error.message);
    await w.sync();
    const result = await raw(w.newcomerSpace, {
      ...join(w),
      proof: [encodeProof(victimInvite.value.token)],
      payload: { invitation: victimInvite.value.id },
    });
    expect(result.reason).toBe(INVITATION_MESSAGES.someone_else);
    expect(await w.newcomerSpace.view.get(`members/${w.newcomer.did}`)).toBeUndefined();
  });

  it("accepts a real join written by the person it names (the control)", async () => {
    const w = await invitedWorld();
    const result = await raw(w.newcomerSpace, {
      ...join(w),
      proof: [encodeProof(w.inv.token)],
      payload: { invitation: w.inv.id },
    });
    expect(result.reason).toBeUndefined();
    expect(await w.newcomerSpace.view.get(`members/${w.newcomer.did}`)).toBeDefined();
  });

  it("refuses a token for a different community", async () => {
    const w = await invitedWorld();
    const token = await w.treasurer.auth.issue({
      issuer: w.treasurer.did,
      audience: w.newcomer.did,
      capabilities: [{ with: spaceUri(newCommunityKey(randomBytes)), can: "member/join" }],
      expiresAt: T0 + DAY_MS,
    });
    if (!token.ok) throw new Error(token.error.message);
    const result = await raw(w.newcomerSpace, {
      ...join(w),
      proof: [encodeProof(token.value)],
      payload: { invitation: await w.treasurer.auth.tokenId(token.value) },
    });
    expect(result.reason).toBe(INVITATION_MESSAGES.unreadable);
    expect(await w.newcomerSpace.view.get(`members/${w.newcomer.did}`)).toBeUndefined();
  });

  it("refuses a token that was not issued by the creator", async () => {
    const w = await invitedWorld();
    const stranger = await phone();
    const token = await stranger.auth.issue({
      issuer: stranger.did,
      audience: w.newcomer.did,
      capabilities: [{ with: spaceUri(w.community.key), can: "member/join" }],
      expiresAt: T0 + DAY_MS,
    });
    if (!token.ok) throw new Error(token.error.message);
    const result = await raw(w.newcomerSpace, {
      ...join(w),
      proof: [encodeProof(token.value)],
      payload: { invitation: await stranger.auth.tokenId(token.value) },
    });
    expect(result.reason).toBe(INVITATION_MESSAGES.unreadable);
  });

  it("refuses a join claimed at or after the invitation's end", async () => {
    const w = await invitedWorld();
    // The end is judged at log time, so the record's log time must reach it first (one day at a time).
    for (let at = T0 + DAY_MS; at <= w.inv.expiresAt; at += DAY_MS) {
      const added = await w.community.addQuote(
        {
          supplier: "Thandi Wholesale",
          order: `Day ${(at - T0) / DAY_MS}`,
          lines: [{ item: "Sugar", unit: "bag", packSize: 1, pricePerPackCents: 12500 }],
          delivery: { feeCents: 0, days: 0 },
        },
        at,
      );
      if (!added.ok) throw new Error(added.error.message);
    }
    await w.sync();
    const result = await raw(w.newcomerSpace, {
      ...join(w),
      proof: [encodeProof(w.inv.token)],
      payload: { invitation: w.inv.id },
      at: w.inv.expiresAt,
    });
    expect(result.reason).toBe(INVITATION_MESSAGES.expired);
  });

  it("refuses a join whose invitation id is not the id of the token it carries", async () => {
    const w = await invitedWorld();
    const result = await raw(w.newcomerSpace, {
      ...join(w),
      proof: [encodeProof(w.inv.token)],
      payload: { invitation: "some-other-id" },
    });
    expect(result.reason).toBe(INVITATION_MESSAGES.unreadable);
    expect(await w.newcomerSpace.view.get("joined/some-other-id")).toBeUndefined();
  });

  it("refuses a founder join from anyone but the creator", async () => {
    const w = await invitedWorld();
    const result = await raw(w.newcomerSpace, { ...join(w), payload: { invitation: "founder" } });
    expect(result.reason).toBe(INVITATION_MESSAGES.unreadable);
    expect(await w.newcomerSpace.view.get(`members/${w.newcomer.did}`)).toBeUndefined();
  });

  it("refuses a member.invited from anyone but the creator", async () => {
    const w = await invitedWorld();
    const stranger = await phone();
    const result = await raw(w.newcomerSpace, {
      type: "member.invited",
      actor: w.newcomer.did,
      space: w.community.key,
      payload: { invitation: "mine", invitee: stranger.did, expiresAt: T0 + DAY_MS },
    });
    expect(result.reason).toBe("Only the creator can invite.");
    expect(await w.newcomerSpace.view.get("invitations/mine")).toBeUndefined();
  });

  it("refuses a join with a proof that is not a token", async () => {
    const w = await invitedWorld();
    const result = await raw(w.newcomerSpace, {
      ...join(w),
      proof: ["not-a-token"],
      payload: { invitation: w.inv.id },
    });
    expect(result.reason).toBe(INVITATION_MESSAGES.unreadable);
  });

  it("refuses an event that belongs to another community", async () => {
    const w = await invitedWorld();
    const result = await raw(w.newcomerSpace, {
      ...join(w),
      space: newCommunityKey(randomBytes),
      proof: [encodeProof(w.inv.token)],
      payload: { invitation: w.inv.id },
    });
    expect(result.reason).toBe(INVITATION_MESSAGES.unreadable);
    expect(await w.newcomerSpace.view.get(`members/${w.newcomer.did}`)).toBeUndefined();
  });

  it("says a person who is already a member is already a member", async () => {
    const w = await invitedWorld();
    const result = await raw(w.community.space, {
      type: "member.joined",
      actor: w.treasurer.did,
      space: w.community.key,
      payload: { invitation: "again" },
    });
    expect(result.reason).toBe("Already a member.");
  });

  it("does not let someone who was never invited write to the community at all", async () => {
    const w = await world();
    const inv = await w.community.invite(w.newcomer.did, T0);
    if (!inv.ok) throw new Error(inv.error.message);
    await w.sync();
    const thief = await phone();
    const thiefSpace = await w.network
      .peer<EventEnvelope>(thief.did as Did)
      .open(
        w.community.space.key,
        communityDefinition(thief.deps, w.treasurer.did, w.community.key),
      );
    const checked = await checkInvitation({
      auth: w.newcomer.auth,
      text: inv.value.code,
      me: w.newcomer.did,
      now: T0,
    });
    if (!checked.ok) throw new Error(checked.error.message);
    const result = await joinCommunity(thief.deps, thiefSpace, checked.value, T0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("not an admitted writer");
  });

  it("gives the same view on every replica when two writers append at the same time", async () => {
    const w = await invitedWorld();
    const second = await phone();
    // At the same moment, on separate replicas: the creator invites a second person, and the newcomer
    // joins (and also sends a join that must be refused).
    const secondInvite = await w.community.invite(second.did, T0 + 5_000);
    if (!secondInvite.ok) throw new Error(secondInvite.error.message);
    await raw(w.newcomerSpace, {
      ...join(w),
      proof: [encodeProof(w.inv.token)],
      payload: { invitation: w.inv.id },
      at: T0 + 1_000,
    });
    await raw(w.newcomerSpace, { ...join(w), payload: { invitation: "founder" }, at: T0 + 2_000 });
    await w.sync();
    // A late replica that only ever meets the newcomer's record.
    const late = await phone();
    const lateSpace = await w.network
      .peer<EventEnvelope>(late.did as Did)
      .open(
        w.community.space.key,
        communityDefinition(late.deps, w.treasurer.did, w.community.key),
      );
    await w.network.replicate<EventEnvelope>(w.newcomerSpace, lateSpace);
    await lateSpace.update();
    const creatorView = await w.community.space.view.list("");
    expect(await w.newcomerSpace.view.list("")).toEqual(creatorView);
    expect(await lateSpace.view.list("")).toEqual(creatorView);
    expect(creatorView.some((entry) => entry.key.startsWith("rejected/"))).toBe(true);
  });
});

// Story 8.1: the name and rules every member sees, and the roles every member sees with their end dates.
describe("the name, rules and roles every member sees (story 8.1)", () => {
  /** Appends a raw `community.named` as `writer` would, and says what `apply` made of it. */
  async function namedBy(
    space: Space<EventEnvelope>,
    writer: { did: Did },
    payload: Record<string, unknown>,
    communityKey: string,
  ) {
    // Built as a raw envelope, not through `createEvent`, which checks the registry first: `apply` must refuse on its own.
    const built = {
      v: 1,
      type: "community.named",
      space: communityKey,
      actor: writer.did,
      proof: [],
      claimedAt: T0,
      nonce: Array.from(randomBytes(16), (b) => b.toString(16).padStart(2, "0")).join(""),
      payload,
    } as unknown as EventEnvelope;
    const receipt = await space.append(built);
    if (!receipt.ok) throw new Error(receipt.error.message);
    await space.update();
    const rejected = (await space.view.get(`rejected/${receipt.value.id}`)) as
      | { reason?: unknown }
      | undefined;
    return { reason: rejected?.reason };
  }

  it("shows the name and the rules note on a second replica", async () => {
    const t = await phone();
    const network = createMemoryRecordNetwork();
    const made = await createCommunity(
      t.deps,
      network.peer<EventEnvelope>(t.did),
      "Ntombi Stokvel",
      T0,
      undefined,
      undefined,
      "We pay in on the first Friday.",
    );
    if (!made.ok) throw new Error(made.error.message);
    const newcomer = await phone();
    const newcomerSpace = await network
      .peer<EventEnvelope>(newcomer.did)
      .open(made.value.space.key, communityDefinition(newcomer.deps, t.did, made.value.key));
    await network.replicate<EventEnvelope>(made.value.space, newcomerSpace);
    await newcomerSpace.update();
    expect(await newcomerSpace.view.get("community/name")).toBe("Ntombi Stokvel");
    expect(await newcomerSpace.view.get("community/rules")).toBe("We pay in on the first Friday.");
  });

  it("refuses a name that holds a phone number, on creation, with nothing made", async () => {
    const t = await phone();
    const made = await createCommunity(
      t.deps,
      createMemoryRecordNetwork().peer<EventEnvelope>(t.did),
      "Call 082 123 4567",
      T0,
    );
    expect(made.ok).toBe(false);
    if (!made.ok) expect(made.error.message).toBe(PERSONAL_DATA_MESSAGE);
  });

  it("refuses a name longer than 80 characters, on creation, in plain words", async () => {
    const t = await phone();
    const made = await createCommunity(
      t.deps,
      createMemoryRecordNetwork().peer<EventEnvelope>(t.did),
      "N".repeat(81),
      T0,
    );
    expect(made.ok).toBe(false);
    if (!made.ok) expect(made.error.message).toBe(NAMING_MESSAGES.name_too_long);
  });

  it("refuses a rules note of more than 500 characters, on creation", async () => {
    const t = await phone();
    const made = await createCommunity(
      t.deps,
      createMemoryRecordNetwork().peer<EventEnvelope>(t.did),
      "Ntombi Stokvel",
      T0,
      undefined,
      undefined,
      "r".repeat(501),
    );
    expect(made.ok).toBe(false);
    if (!made.ok) expect(made.error.message).toBe(NAMING_MESSAGES.rules_too_long);
  });

  // `apply` checks the shape itself, so a malformed naming written straight to the record (not through the phone's
  // check) stores nothing and leaves a plain refusal (AGENTS rule 3: the record decides, not the ingest path).
  it.each([
    ["an empty name", { name: "", rules: "" }],
    ["a name of 81 characters", { name: "N".repeat(81), rules: "" }],
    ["a name that is only a phone number", { name: "082 123 4567", rules: "" }],
    ["a rules note with a line break", { name: "Ntombi Stokvel Club", rules: "Pay in\nlate" }],
    ["rules over 500 characters", { name: "Ntombi Stokvel Club", rules: "r".repeat(501) }],
    ["rules that are not text", { name: "Ntombi Stokvel Club", rules: 5 }],
    ["an extra field", { name: "Ntombi Stokvel Club", rules: "", approvals: 2 }],
    ["a missing name", { rules: "Pay in monthly." }],
    ["a name that holds a phone number", { name: "Call 082 123 4567", rules: "" }],
  ] as const)("stores nothing and refuses a malformed naming with %s", async (_label, payload) => {
    const w = await world();
    const result = await namedBy(
      w.community.space,
      w.treasurer,
      payload as Record<string, unknown>,
      w.community.key,
    );
    expect(typeof result.reason).toBe("string");
    expect(result.reason).toBeTypeOf("string");
    await w.community.space.update();
    expect(await w.community.space.view.get("community/name")).toBe("Ntombi Stokvel");
    expect(await w.community.space.view.get("community/rules")).toBe("");
  });

  it("refuses a malformed naming in plain words, not a raw shape message", async () => {
    const w = await world();
    const result = await namedBy(
      w.community.space,
      w.treasurer,
      { name: "N".repeat(81), rules: "" },
      w.community.key,
    );
    expect(result.reason).toBe(NAMING_MESSAGES.unreadable);
  });

  it("refuses a naming by a member who is not a treasurer", async () => {
    const w = await world();
    const invitation = await w.community.invite(w.newcomer.did, T0);
    if (!invitation.ok) throw new Error(invitation.error.message);
    await w.sync();
    const checked = await checkInvitation({
      auth: w.newcomer.auth,
      text: invitation.value.code,
      me: w.newcomer.did,
      now: T0 + DAY_MS,
      isUsed: isUsedIn(w.newcomerSpace),
    });
    if (!checked.ok) throw new Error(checked.error.message);
    await joinCommunity(w.newcomer.deps, w.newcomerSpace, checked.value, T0 + DAY_MS);
    await w.sync();

    const result = await namedBy(
      w.newcomerSpace,
      w.newcomer,
      { name: "Our Stokvel", rules: "" },
      w.community.key,
    );
    expect(result.reason).toBe(NAMING_MESSAGES.not_permitted);
    expect(await w.newcomerSpace.view.get("community/name")).toBe("Ntombi Stokvel");
  });

  it("refuses a rename that holds a phone number, and keeps the name", async () => {
    const w = await world();
    const result = await namedBy(
      w.community.space,
      w.treasurer,
      { name: "Ntombi Stokvel", rules: "Call 082 123 4567" },
      w.community.key,
    );
    expect(result.reason).toBe(PERSONAL_DATA_MESSAGE);
    await w.community.space.update();
    expect(await w.community.space.view.get("community/rules")).toBe("");
  });

  it("lets a co-treasurer whose role stands name the community, and shows it on a second replica", async () => {
    const w = await world();
    const invitation = await w.community.invite(w.newcomer.did, T0);
    if (!invitation.ok) throw new Error(invitation.error.message);
    await w.sync();
    const checked = await checkInvitation({
      auth: w.newcomer.auth,
      text: invitation.value.code,
      me: w.newcomer.did,
      now: T0 + DAY_MS,
      isUsed: isUsedIn(w.newcomerSpace),
    });
    if (!checked.ok) throw new Error(checked.error.message);
    await joinCommunity(w.newcomer.deps, w.newcomerSpace, checked.value, T0 + DAY_MS);
    await w.sync();
    const granted = await w.community.grantRole(
      w.newcomer.did,
      "co-treasurer",
      { days: 30, limit: money("ZAR", 100_000) },
      T0 + DAY_MS,
    );
    if (!granted.ok) throw new Error(granted.error.message);
    await w.sync();

    const result = await namedBy(
      w.newcomerSpace,
      w.newcomer,
      { name: "Ntombi Stokvel Club", rules: "Pay in monthly." },
      w.community.key,
    );
    expect(result.reason).toBeUndefined();
    await w.sync();
    expect(await w.community.space.view.get("community/name")).toBe("Ntombi Stokvel Club");
    expect(await w.community.space.view.get("community/rules")).toBe("Pay in monthly.");
  });

  it("shows every member's role and its end date to every member", async () => {
    const w = await world();
    const invitation = await w.community.invite(w.newcomer.did, T0);
    if (!invitation.ok) throw new Error(invitation.error.message);
    await w.sync();
    const checked = await checkInvitation({
      auth: w.newcomer.auth,
      text: invitation.value.code,
      me: w.newcomer.did,
      now: T0 + DAY_MS,
      isUsed: isUsedIn(w.newcomerSpace),
    });
    if (!checked.ok) throw new Error(checked.error.message);
    await joinCommunity(w.newcomer.deps, w.newcomerSpace, checked.value, T0 + DAY_MS);
    await w.sync();
    const granted = await w.community.grantRole(w.newcomer.did, "driver", { days: 7 }, T0 + DAY_MS);
    if (!granted.ok) throw new Error(granted.error.message);
    await w.sync();

    // The newcomer's own replica: the creator's grant is shown to them too, with the day it ends.
    await w.newcomerSpace.update();
    const seen = holdersOf(await w.newcomerSpace.view.list("roles/"));
    expect(seen).toEqual([
      expect.objectContaining({
        holder: w.newcomer.did,
        role: "driver",
        grantor: w.treasurer.did,
        expiresAt: granted.value.expiresAt,
      }),
    ]);
  });
});
