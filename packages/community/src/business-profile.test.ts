// A small retailer's business profile (story 9.1). A supplier circle (a community) invites the retailer with the usual
// capability; the retailer then publishes a profile that shows only the fields they chose, signed with their DID key.
// Simulated phones on one in-memory record, as member-area.test.ts does. The record must hold nothing the retailer kept back.
import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import { createMemoryRecordNetwork, type MemoryRecordNetwork } from "@shopong/adapters-memory";
import {
  businessProfileBytes,
  createEvent,
  type BusinessProfileFields,
  type EventEnvelope,
  webCryptoSha512,
} from "@shopong/events";
import type { Did, Signature } from "@shopong/ports";
import { describe, expect, it } from "vite-plus/test";
import {
  DAY_MS,
  checkInvitation,
  communityDefinition,
  createCommunity,
  joinCommunity,
  type CommunityDeps,
} from "./index.js";
import { appendChecked, type Community as CommunityHandle } from "./community.js";
import { PROFILE_MESSAGES } from "./profile.js";
import { isCurrentGrantIn } from "./roles.js";
import { coTreasurerJoinRecorded } from "./roles.js";

const T0 = 1_793_000_000_000;

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

/** One supplier circle on one record: the creator and the members admitted to it. */
async function circle() {
  const network: MemoryRecordNetwork = createMemoryRecordNetwork();
  const creator = await phone();
  const made = await createCommunity(
    creator.deps,
    network.peer<EventEnvelope>(creator.did),
    "Mpho Suppliers",
    T0,
  );
  if (!made.ok) throw new Error(made.error.message);
  const community = made.value;
  const members: CommunityHandle[] = [community];

  async function admit(p: Phone, now = T0): Promise<CommunityHandle> {
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

  /** The treasurer removes `member`, as member-area.test.ts does. */
  async function remove(member: string, at: number): Promise<void> {
    const event = createEvent({
      type: "member.removed",
      space: community.key,
      actor: community.me,
      proof: [],
      claimedAt: at,
      nonce: "a".repeat(32),
      payload: { member },
    } as never) as EventEnvelope;
    const receipt = await appendChecked(community.space, event);
    if (!receipt.ok) throw new Error(receipt.error.message);
    await sync();
  }

  return { network, creator, community, members, admit, sync, remove };
}

describe("a small retailer's business profile (story 9.1)", () => {
  it("a supplier circle invites a retailer, and the retailer's signed profile shows in the circle", async () => {
    const c = await circle();
    const retailer = await c.admit(await phone());
    const published = await retailer.publishProfile(
      { name: "Thabo's Spaza", kind: "spaza shop", area: "Umbilo" },
      T0 + 2 * DAY_MS,
    );
    expect(published.ok).toBe(true);
    await c.sync();
    const seen = await c.community.profiles();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      member: retailer.me,
      name: "Thabo's Spaza",
      kind: "spaza shop",
      area: "Umbilo",
    });
  });

  it("shows only the fields the retailer chose: a field left out is not in the record at all", async () => {
    const c = await circle();
    const retailer = await c.admit(await phone());
    const published = await retailer.publishProfile({ name: "Thabo's Spaza" }, T0 + 2 * DAY_MS);
    expect(published.ok).toBe(true);
    await c.sync();
    await c.community.space.update();
    const stored = await c.community.space.view.get(`profiles/${retailer.me}`);
    expect(Object.keys(stored as object).sort()).toEqual(["name", "signature"]);
    const [seen] = await c.community.profiles();
    expect(seen).toMatchObject({ name: "Thabo's Spaza" });
    expect(seen?.kind).toBeUndefined();
    expect(seen?.area).toBeUndefined();
  });

  it("is signed by the retailer's DID over exactly the shown fields and this circle's key", async () => {
    const c = await circle();
    const retailer = await c.admit(await phone());
    const fields: BusinessProfileFields = { name: "Thabo's Spaza", kind: "general dealer" };
    await retailer.publishProfile(fields, T0 + 2 * DAY_MS);
    await c.sync();
    const [seen] = await c.community.profiles();
    expect(seen).toBeDefined();
    const bytes = businessProfileBytes(c.community.key, fields);
    expect(
      await c.creator.auth.verifySignature(retailer.me as Did, bytes, seen!.signature as Signature),
    ).toBe(true);
    // The same signature does not cover a different shown field, or another circle.
    expect(
      await c.creator.auth.verifySignature(
        retailer.me as Did,
        businessProfileBytes(c.community.key, { ...fields, kind: "other" }),
        seen!.signature as Signature,
      ),
    ).toBe(false);
    expect(
      await c.creator.auth.verifySignature(
        retailer.me as Did,
        businessProfileBytes("cd".repeat(32), fields),
        seen!.signature as Signature,
      ),
    ).toBe(false);
  });

  it("refuses, on the phone, a profile that would show a phone number, an address or an unknown kind", async () => {
    const c = await circle();
    const retailer = await c.admit(await phone());
    const phoneName = await retailer.publishProfile({ name: "082 123 4567" }, T0 + 2 * DAY_MS);
    expect(phoneName.ok).toBe(false);
    const streetName = await retailer.publishProfile({ name: "12 Church Street" }, T0 + 2 * DAY_MS);
    expect(streetName.ok).toBe(false);
    const streetArea = await retailer.publishProfile(
      { name: "Thabo's Spaza", area: "12 Church Street" },
      T0 + 2 * DAY_MS,
    );
    expect(streetArea.ok).toBe(false);
    const kind = await retailer.publishProfile(
      { name: "Thabo's Spaza", kind: "bank" },
      T0 + 2 * DAY_MS,
    );
    expect(kind.ok).toBe(false);
    if (!kind.ok) expect(kind.error.message).toBe(PROFILE_MESSAGES.unknown_kind);
    await c.sync();
    expect(await c.community.profiles()).toEqual([]);
  });

  it("a later profile replaces the earlier one", async () => {
    const c = await circle();
    const retailer = await c.admit(await phone());
    await retailer.publishProfile({ name: "Thabo's Spaza" }, T0 + 2 * DAY_MS);
    await retailer.publishProfile(
      { name: "Thabo's Spaza", area: "Umbilo" },
      T0 + 2 * DAY_MS + 60_000,
    );
    await c.sync();
    const seen = await c.community.profiles();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ name: "Thabo's Spaza", area: "Umbilo" });
  });

  it("a removed member cannot publish a profile into the circle", async () => {
    const c = await circle();
    const retailer = await c.admit(await phone());
    await c.remove(retailer.me, T0 + 2 * DAY_MS);
    const refused = await retailer.publishProfile({ name: "Thabo's Spaza" }, T0 + 3 * DAY_MS);
    // The record refuses a removed person as a writer before `apply` reads the profile, so the sentence is the record's.
    expect(refused.ok).toBe(false);
    await c.sync();
    expect(await c.community.profiles()).toEqual([]);
  });

  it("refuses a profile from someone who was invited but has not joined", async () => {
    const c = await circle();
    const person = await phone();
    const invited = await c.community.invite(person.did, T0);
    if (!invited.ok) throw new Error(invited.error.message);
    const space = await c.network
      .peer<EventEnvelope>(person.did)
      .open(
        c.community.space.key,
        communityDefinition(person.deps, c.creator.did, c.community.key),
      );
    await c.network.replicate<EventEnvelope>(c.community.space, space);
    const payload = { name: "Thabo's Spaza" };
    const signed = await person.auth.sign(
      person.did,
      businessProfileBytes(c.community.key, payload),
    );
    if (!signed.ok) throw new Error(signed.error.message);
    const event = createEvent({
      type: "business.profile",
      space: c.community.key,
      actor: person.did,
      proof: [],
      claimedAt: T0 + DAY_MS,
      nonce: "d".repeat(32),
      payload: { ...payload, signature: signed.value },
    } as never) as EventEnvelope;
    expect((await appendChecked(space, event)).ok).toBe(true);
    // The invitee has not joined, so `sync` does not reach their log: replicate it to the circle first.
    await c.network.replicate<EventEnvelope>(c.community.space, space);
    await c.sync();
    await c.community.space.update();
    const rejected = await c.community.space.view.list("rejected/");
    expect(
      rejected.some(
        (row) =>
          typeof row.value === "object" &&
          row.value !== null &&
          (row.value as { reason?: unknown }).reason === PROFILE_MESSAGES.not_a_member,
      ),
    ).toBe(true);
    expect(await c.community.profiles()).toEqual([]);
  });

  it("refuses a profile signed by someone other than the person it names", async () => {
    const c = await circle();
    const retailer = await c.admit(await phone());
    const payload = { name: "Thabo's Spaza", kind: "spaza shop" } as const;
    // The creator's key signs bytes that name the retailer as the actor: the record must refuse it.
    const bytes = businessProfileBytes(c.community.key, payload);
    const forged = await c.creator.auth.sign(c.creator.did, bytes);
    if (!forged.ok) throw new Error(forged.error.message);
    const event = createEvent({
      type: "business.profile",
      space: c.community.key,
      actor: retailer.me,
      proof: [],
      claimedAt: T0 + 2 * DAY_MS,
      nonce: "b".repeat(32),
      payload: { ...payload, signature: forged.value },
    } as never) as EventEnvelope;
    const receipt = await appendChecked(retailer.space, event);
    expect(receipt.ok).toBe(true);
    await c.sync();
    await c.community.space.update();
    const rejected = await c.community.space.view.list("rejected/");
    expect(
      rejected.some(
        (row) =>
          typeof row.value === "object" &&
          row.value !== null &&
          (row.value as { reason?: unknown }).reason === PROFILE_MESSAGES.bad_signature,
      ),
    ).toBe(true);
    expect(await c.community.profiles()).toEqual([]);
  });

  it("refuses a profile whose shown fields were changed after signing", async () => {
    const c = await circle();
    const person = await phone();
    const retailer = await c.admit(person);
    const signed = await person.auth.sign(
      person.did,
      businessProfileBytes(c.community.key, { name: "Thabo's Spaza" }),
    );
    if (!signed.ok) throw new Error(signed.error.message);
    const event = createEvent({
      type: "business.profile",
      space: c.community.key,
      actor: retailer.me,
      proof: [],
      claimedAt: T0 + 2 * DAY_MS,
      nonce: "c".repeat(32),
      // The retailer signed the name alone, then added a suburb the signature does not cover.
      payload: { name: "Thabo's Spaza", area: "Umbilo", signature: signed.value },
    } as never) as EventEnvelope;
    const receipt = await appendChecked(retailer.space, event);
    expect(receipt.ok).toBe(true);
    await c.sync();
    expect(await c.community.profiles()).toEqual([]);
  });
});
