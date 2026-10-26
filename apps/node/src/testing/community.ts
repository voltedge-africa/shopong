// Test helpers shared by the Node's route tests: phones (identities with the community deps) and a community
// on the in-memory record, with a creator and two members admitted and joined (as in the roles tests).
import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import { createMemoryRecordNetwork } from "@shopong/adapters-memory";
import {
  checkInvitation,
  communityDefinition,
  createCommunity,
  DAY_MS,
  joinCommunity,
  type Community,
  type CommunityDeps,
} from "@shopong/community";
import { webCryptoSha512, type EventEnvelope } from "@shopong/events";
import type { CapabilityAuth, Did } from "@shopong/ports";

export const T0 = 1_793_000_000_000;

export function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

export interface Phone {
  auth: CapabilityAuth;
  did: Did;
  deps: CommunityDeps;
}

export async function phone(): Promise<Phone> {
  const auth = new IsoUcanCapabilityAuth();
  const did = await auth.createIdentity();
  return {
    auth,
    did,
    deps: {
      auth,
      sha512: webCryptoSha512,
      randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
    },
  };
}

/** A community with its creator, and two members admitted and joined. */
export async function community() {
  const network = createMemoryRecordNetwork();
  const creator = await phone();
  const made = await createCommunity(
    creator.deps,
    network.peer<EventEnvelope>(creator.did),
    "Test",
    T0,
  );
  if (!made.ok) throw new Error(made.error.message);
  const founder: Community = made.value;

  async function admit(p: Phone, at: number): Promise<Community> {
    const invited = await founder.invite(p.did, at);
    if (!invited.ok) throw new Error(invited.error.message);
    const space = await network
      .peer<EventEnvelope>(p.did)
      .open(founder.space.key, communityDefinition(p.deps, creator.did, founder.key));
    await network.replicate<EventEnvelope>(founder.space, space);
    const checked = await checkInvitation({
      auth: p.auth,
      text: invited.value.code,
      me: p.did,
      now: at + DAY_MS,
    });
    if (!checked.ok) throw new Error(checked.error.message);
    const joined = await joinCommunity(p.deps, space, checked.value, at + DAY_MS);
    if (!joined.ok) throw new Error(joined.error.message);
    await network.replicate<EventEnvelope>(founder.space, joined.value.space);
    return joined.value;
  }

  const driver = await phone();
  const other = await phone();
  const driverCommunity = await admit(driver, T0);
  const otherCommunity = await admit(other, T0);
  return { network, creator, founder, driver, other, driverCommunity, otherCommunity };
}
