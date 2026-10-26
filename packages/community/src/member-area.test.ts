// A member's area (story 7.3): the member records a suburb or town, and the record keeps that name and nothing finer.
// A member who has been removed records nothing. Simulated phones on one in-memory record, as delivery.test.ts does.
import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import { createMemoryRecordNetwork, type MemoryRecordNetwork } from "@shopong/adapters-memory";
import { createEvent, type EventEnvelope, webCryptoSha512 } from "@shopong/events";
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
import { coTreasurerJoinRecorded, isCurrentGrantIn } from "./roles.js";

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

/** One community on one record: the creator and the members admitted to it. */
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

  /** The treasurer removes `member`, as removal.test.ts does: a `member.removed` the record judges. */
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

describe("a member's area (story 7.3)", () => {
  it("records the suburb or town a member gives, and nothing else about the member", async () => {
    const t = await town();
    const joiner = await t.admit(await phone());
    const recorded = await joiner.setMemberArea("  Umbilo  ", T0 + DAY_MS);
    expect(recorded.ok).toBe(true);
    await t.sync();
    await joiner.space.update();
    expect(await joiner.space.view.get(`areas/${joiner.me}`)).toEqual({ area: "Umbilo" });
  });

  it("refuses a street-level area on the phone, with the plain sentence, and writes nothing", async () => {
    const t = await town();
    const joiner = await t.admit(await phone());
    const refused = await joiner.setMemberArea("12 Church Street, Umbilo", T0 + DAY_MS);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.message).toBe(
      "Give the suburb or town only, with no street, number or erf.",
    );
    await t.sync();
    await joiner.space.update();
    expect(await joiner.space.view.list("areas/")).toEqual([]);
  });

  it("refuses the area of a member who has been removed, so the record does not keep it", async () => {
    const t = await town();
    const joiner = await t.admit(await phone());
    await t.remove(joiner.me, T0 + DAY_MS);
    const recorded = await joiner.setMemberArea("Umbilo", T0 + 2 * DAY_MS);
    expect(recorded.ok).toBe(false);
    await t.sync();
    await t.community.space.update();
    expect(await t.community.space.view.get(`areas/${joiner.me}`)).toBeUndefined();
  });

  it("keeps no address and no coordinate in the record: the view holds the name, the area and a commitment", async () => {
    const t = await town();
    const joiner = await t.admit(await phone());
    await joiner.setMemberArea("Umbilo", T0 + DAY_MS);
    const placed = await t.community.registerPlace(
      {
        id: "a".repeat(64),
        label: "Mamelodi Wholesale depot",
        area: "Mamelodi",
        addressCommitment: "c".repeat(128),
      },
      T0 + 2 * DAY_MS,
    );
    expect(placed.ok).toBe(true);
    await t.sync();
    await t.community.space.update();
    const view = [
      ...(await t.community.space.view.list("places/")),
      ...(await t.community.space.view.list("areas/")),
    ];
    const text = JSON.stringify(view);
    expect(text).not.toContain("Church");
    expect(text).not.toMatch(/-25\.7|28\.4|\blat\b|\blng\b/);
    expect(text).toContain("c".repeat(128));
  });
});
