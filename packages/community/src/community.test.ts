import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import { createMemoryRecordNetwork } from "@shopong/adapters-memory";
import { webCryptoSha512, type EventEnvelope } from "@shopong/events";
import type { Did, Space } from "@shopong/ports";
import { describe, expect, it } from "vite-plus/test";
import {
  DAY_MS,
  INVITATION_DAYS,
  INVITATION_MESSAGES,
  EMPTY_NAME_MESSAGE,
  checkInvitation,
  communityDefinition,
  createCommunity,
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
    for (const text of [
      tampered,
      otherKey,
      otherCreator,
      "hello",
      "",
      "shopong://join?space=1",
      "?%E0%A4%A",
    ]) {
      const result = await check(text);
      expect(result.ok, text).toBe(false);
      if (!result.ok) expect(result.error.message, text).toBe(INVITATION_MESSAGES.unreadable);
    }
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
  it("is refused when someone who was never invited tries to join with another person's token", async () => {
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
  });

  it("gives the same view whichever order the records meet in", async () => {
    const w = await world();
    const inv = await w.community.invite(w.newcomer.did, T0);
    if (!inv.ok) throw new Error(inv.error.message);
    await w.sync();
    const checked = await checkInvitation({
      auth: w.newcomer.auth,
      text: inv.value.code,
      me: w.newcomer.did,
      now: T0,
    });
    if (!checked.ok) throw new Error(checked.error.message);
    await joinCommunity(w.newcomer.deps, w.newcomerSpace, checked.value, T0);
    await w.sync();
    expect(await w.community.space.view.list("")).toEqual(await w.newcomerSpace.view.list(""));
  });
});
