// `file.attached` in the record (story 3.7): `apply` names a file only in the strict form, from a sender whose role
// allows the purpose at log time, and it refuses personal data in the name. Driven through the in-memory record.
import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import { createMemoryRecordNetwork } from "@shopong/adapters-memory";
import { webCryptoSha512, type EventEnvelope } from "@shopong/events";
import { describe, expect, it } from "vite-plus/test";
import {
  FILE_ROLE_MESSAGES,
  createCommunity,
  filesOf,
  fileOfOrderKey,
  type Community,
  type CommunityDeps,
} from "./index.js";
import { toHex } from "./space.js";

const T0 = 1_793_000_000_000;
const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const HASH = "ab".repeat(64);

async function creatorCommunity(): Promise<Community> {
  const auth = new IsoUcanCapabilityAuth();
  const did = await auth.createIdentity();
  const deps: CommunityDeps = { auth, sha512: webCryptoSha512, randomBytes };
  const network = createMemoryRecordNetwork();
  const record = network.peer<EventEnvelope>(did);
  const made = await createCommunity(deps, record, "Spaza Co-op", T0);
  if (!made.ok) throw new Error(made.error.message);
  return made.value;
}

/**
 * The envelope as a writer would send it. Built by hand, so a payload outside the strict form still reaches `apply`
 * (the phone's `createEvent` would refuse it first, which is the first line; `apply` is the second).
 */
function fileEvent(
  community: Community,
  payload: Record<string, unknown>,
  at: number,
): EventEnvelope {
  return {
    v: 1,
    type: "file.attached",
    space: community.key,
    actor: community.me,
    proof: [],
    claimedAt: at,
    nonce: toHex(randomBytes(16)),
    payload,
  } as unknown as EventEnvelope;
}

/** Appends the event straight to the space (past the phone's own checks) and reads the verdict `apply` wrote. */
async function appendAndJudge(community: Community, event: EventEnvelope) {
  const receipt = await community.space.append(event);
  if (!receipt.ok) throw new Error(receipt.error.message);
  await community.space.update();
  const rejected = (await community.space.view.get(`rejected/${receipt.value.id}`)) as
    | { reason: string }
    | undefined;
  return rejected?.reason;
}

const photo = {
  hash: HASH,
  size: 2048,
  type: "image/jpeg",
  name: "Delivery photo abababab",
  purpose: "delivery-photo",
  order: "March stock",
};
const priceList = {
  hash: "cd".repeat(64),
  size: 4096,
  type: "application/pdf",
  name: "Price list cdcdcdcd",
  purpose: "price-list",
  order: "March stock",
  supplier: "Makro",
};

describe("file.attached in the record", () => {
  it("records a treasurer's price list under its order and supplier", async () => {
    const community = await creatorCommunity();
    const reason = await appendAndJudge(community, fileEvent(community, priceList, T0 + 1000));
    expect(reason).toBeUndefined();
    const stored = await community.space.view.get(fileOfOrderKey("March stock", priceList.hash));
    expect(stored).toMatchObject({ hash: priceList.hash, supplier: "Makro", by: community.me });
    const files = await filesOf(community.space.view, "March stock");
    expect(files.map((f) => f.hash)).toEqual([priceList.hash]);
  });

  it("refuses a delivery photo from someone with no driver role", async () => {
    const community = await creatorCommunity();
    const reason = await appendAndJudge(community, fileEvent(community, photo, T0 + 1000));
    expect(reason).toBe(FILE_ROLE_MESSAGES.delivery_photo);
    expect(await community.space.view.get(fileOfOrderKey("March stock", HASH))).toBeUndefined();
  });

  it("refuses a payload outside the strict form (an extra field, a bad hash, a traversal name)", async () => {
    const community = await creatorCommunity();
    const extra = await appendAndJudge(
      community,
      fileEvent(community, { ...priceList, gps: "26.2 S" }, T0 + 1000),
    );
    expect(extra).toBeDefined();
    const badHash = await appendAndJudge(
      community,
      fileEvent(community, { ...priceList, hash: "x" }, T0 + 2000),
    );
    expect(badHash).toBeDefined();
    const traversal = await appendAndJudge(
      community,
      fileEvent(community, { ...priceList, name: "../../etc/passwd" }, T0 + 3000),
    );
    expect(traversal).toBeDefined();
  });

  it("refuses a file name that carries a street address: the record never holds a person's file name", async () => {
    const community = await creatorCommunity();
    const reason = await appendAndJudge(
      community,
      fileEvent(community, { ...priceList, name: "14 Kgosi Street gate.jpg" }, T0 + 1000),
    );
    expect(reason).toBeDefined();
    expect(
      await community.space.view.get(fileOfOrderKey("March stock", priceList.hash)),
    ).toBeUndefined();
  });
});
