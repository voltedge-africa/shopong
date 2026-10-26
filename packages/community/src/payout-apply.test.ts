// Approve and pay a supplier (story 4.7), judged by `apply` on the record: the approvals setting, the payment, and each
// approval (one per person, within their limit, signed for this community and payment). Simulated phones on one
// in-memory record, as roles.test.ts does. Rows are the security and money rows of the plan.
import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import { createMemoryRecordNetwork, type MemoryRecordNetwork } from "@shopong/adapters-memory";
import { createEvent, webCryptoSha512, type EventEnvelope } from "@shopong/events";
import type { Did, Space } from "@shopong/ports";
import { describe, expect, it } from "vite-plus/test";
import {
  DAY_MS,
  checkInvitation,
  communityDefinition,
  createCommunity,
  joinCommunity,
  logTimeOf,
  type Community,
  type CommunityDeps,
} from "./index.js";
import { approvalBytes, approvalKey, approvalsOf, payoutKey, type PayoutTerms } from "./payout.js";
import { coTreasurerJoinRecorded, isCurrentGrantIn } from "./roles.js";
import { newCommunityKey } from "./space.js";

const T0 = 1_793_000_000_000;
const DAYS = (n: number) => n * DAY_MS;
const rand = (n: number) => ({ currency: "ZAR" as const, minor: n * 100 });
const ORDER = "Spaza restock";
const SUPPLIER = "Makro Soweto";
const BANK = "12".repeat(64);
const TERMS: PayoutTerms = { order: ORDER, supplier: SUPPLIER, amountMinor: 50000, bank: BANK };

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

async function phone() {
  const auth = new IsoUcanCapabilityAuth();
  const did = await auth.createIdentity();
  const deps: CommunityDeps = { auth, sha512: webCryptoSha512, randomBytes };
  return { auth, did, deps };
}
type Phone = Awaited<ReturnType<typeof phone>>;

/** One community on one record: the creator, and people admitted to it. */
async function town(approvals?: number) {
  const network: MemoryRecordNetwork = createMemoryRecordNetwork();
  const creator = await phone();
  const key = newCommunityKey(randomBytes);
  const made = await createCommunity(
    creator.deps,
    network.peer<EventEnvelope>(creator.did),
    "Ntombi Stokvel",
    T0,
    key,
    approvals,
  );
  if (!made.ok) throw new Error(made.error.message);
  const community = made.value;
  const members: Community[] = [community];

  async function admit(p: Phone, now = T0): Promise<Community> {
    const invited = await community.invite(p.did, now);
    if (!invited.ok) throw new Error(invited.error.message);
    const space = await network
      .peer<EventEnvelope>(p.did)
      .open(community.space.key, communityDefinition(p.deps, creator.did, key));
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
      for (const member of members)
        await network.replicate<EventEnvelope>(community.space, member.space);
    }
  }
  return { network, creator, community, key, admit, sync, members };
}
type Town = Awaited<ReturnType<typeof town>>;

/** Bring log time up to `at` with the creator's own quotes, a day at a time (story 3.6's cap). */
async function recordAt(t: Town, at: number): Promise<void> {
  for (let step = 0; step < 400; step++) {
    await t.community.space.update();
    const logTime = (await logTimeOf(t.community.space.view)) ?? T0;
    if (logTime >= at) break;
    const next = Math.min(at, logTime + DAY_MS);
    const added = await t.community.addQuote(
      {
        supplier: "Filler Wholesale",
        order: `Log ${step}`,
        lines: [{ item: "Sugar", unit: "bag", packSize: 1, pricePerPackCents: 12500 }],
        delivery: { feeCents: 0, days: 0 },
      },
      next,
    );
    if (!added.ok) throw new Error(added.error.message);
  }
  await t.sync();
}

/** Writes one event as `actor` through their own replica and reads back whether the record refused it. */
async function write(
  space: Space<EventEnvelope>,
  key: string,
  type: string,
  actor: Did,
  payload: Record<string, unknown>,
  claimedAt: number,
  raw = false,
): Promise<{ id: string; rejected: string | undefined }> {
  const fields = {
    type,
    space: key,
    actor,
    proof: [],
    claimedAt,
    nonce: hex(randomBytes(16)),
    payload,
  };
  // `raw` sends an envelope `createEvent` would refuse, as a hostile writer could (the record must still refuse it).
  const event = (raw ? { v: 1, ...fields } : createEvent(fields as never)) as EventEnvelope;
  const receipt = await space.append(event);
  if (!receipt.ok) throw new Error(receipt.error.message);
  await space.update();
  const marker = (await space.view.get(`rejected/${receipt.value.id}`)) as
    | { reason?: string }
    | undefined;
  return { id: receipt.value.id, rejected: marker?.reason };
}

async function approve(
  t: Town,
  who: Phone,
  payout: string,
  terms: PayoutTerms,
  at: number,
  options: { signer?: Phone; space?: string; amountMinor?: number; spaceKey?: string } = {},
) {
  const space = t.members.find((m) => m.me === who.did)!.space;
  const signedFor = approvalBytes(options.space ?? t.key, payout, who.did, terms);
  const signer = options.signer ?? who;
  const signature = await signer.auth.sign(signer.did, signedFor);
  if (!signature.ok) throw new Error("sign failed");
  return write(
    space,
    options.spaceKey ?? t.key,
    "payment.approved",
    who.did,
    {
      payout,
      order: terms.order,
      supplier: terms.supplier,
      amount: { currency: "ZAR", minor: options.amountMinor ?? terms.amountMinor },
      bank: terms.bank,
      signature: signature.value,
    },
    at,
  );
}

/** A treasurer's quote for the supplier, then the payment as the creator, both on the record. */
async function withPayout(t: Town, at = T0 + DAYS(3), amountMinor = 50000) {
  await recordAt(t, at);
  const quote = await t.community.addQuote(
    {
      supplier: SUPPLIER,
      order: ORDER,
      lines: [{ item: "Sugar", unit: "bag", packSize: 1, pricePerPackCents: 12500 }],
      delivery: { feeCents: 0, days: 0 },
    },
    at,
  );
  if (!quote.ok) throw new Error(quote.error.message);
  const payout = await write(
    t.community.space,
    t.key,
    "payment.payout",
    t.creator.did,
    {
      order: ORDER,
      supplier: SUPPLIER,
      amount: { currency: "ZAR", minor: amountMinor },
      recommendation: "clear",
      bank: BANK,
    },
    at,
  );
  await t.sync();
  return payout.id;
}

describe("the approvals setting, in the founding event", () => {
  it("is 2 when the community is made without one", async () => {
    const t = await town();
    await t.community.space.update();
    expect(await approvalsOf(t.community.space.view)).toBe(2);
  });

  it.each([1, 2, 3, 4, 5])("is %i when the founding event says so", async (n) => {
    const t = await town(n);
    await t.community.space.update();
    expect(await approvalsOf(t.community.space.view)).toBe(n);
  });

  it.each([
    ["text", "3"],
    ["zero", 0],
    ["six", 6],
    ["a fraction", 2.5],
    ["null", null],
  ])("refuses a founding event whose setting is %s", async (_name, value) => {
    const network = createMemoryRecordNetwork();
    const p = await phone();
    const key = newCommunityKey(randomBytes);
    const space = await network
      .peer<EventEnvelope>(p.did)
      .create(communityDefinition(p.deps, p.did, key));
    const founded = await write(
      space,
      key,
      "member.joined",
      p.did,
      { invitation: "founder", approvals: value },
      T0,
      true,
    );
    expect(founded.rejected).toBe("The number of approvals must be a whole number from 1 to 5.");
    await space.update();
    expect(await space.view.get("settings/approvals")).toBeUndefined();
    expect(await approvalsOf(space.view)).toBe(2);
  });
});

describe("a payment is recorded by the treasurer only, from a quote", () => {
  it("is recorded for a quoted supplier, keyed by its record event id", async () => {
    const t = await town();
    const id = await withPayout(t);
    await t.community.space.update();
    expect(await t.community.space.view.get(payoutKey(id))).toMatchObject({
      order: ORDER,
      supplier: SUPPLIER,
      amountMinor: 50000,
      recommendation: "clear",
      bank: BANK,
    });
  });

  it("is refused for a supplier with no quote", async () => {
    const t = await town();
    await recordAt(t, T0 + DAYS(3));
    const written = await write(
      t.community.space,
      t.key,
      "payment.payout",
      t.creator.did,
      {
        order: ORDER,
        supplier: "Nobody",
        amount: { currency: "ZAR", minor: 5 },
        recommendation: "none",
        bank: BANK,
      },
      T0 + DAYS(3),
    );
    expect(written.rejected).toBe("There is no quote from that supplier for this order.");
  });

  it("is refused from a member who is not the treasurer", async () => {
    const t = await town();
    const m = await phone();
    const memberTown = await t.admit(m);
    await withPayout(t);
    const written = await write(
      memberTown.space,
      t.key,
      "payment.payout",
      m.did,
      {
        order: ORDER,
        supplier: SUPPLIER,
        amount: { currency: "ZAR", minor: 50000 },
        recommendation: "clear",
        bank: BANK,
      },
      T0 + DAYS(3),
    );
    expect(written.rejected).toBe("Only the treasurer can pay a supplier.");
  });

  it("refuses a recommendation the ranking does not use", async () => {
    const t = await town();
    await recordAt(t, T0 + DAYS(3));
    await t.community.addQuote(
      {
        supplier: SUPPLIER,
        order: ORDER,
        lines: [{ item: "Sugar", unit: "bag", packSize: 1, pricePerPackCents: 12500 }],
        delivery: { feeCents: 0, days: 0 },
      },
      T0 + DAYS(3),
    );
    const written = await write(
      t.community.space,
      t.key,
      "payment.payout",
      t.creator.did,
      {
        order: ORDER,
        supplier: SUPPLIER,
        amount: { currency: "ZAR", minor: 50000 },
        recommendation: "cheapest",
        bank: BANK,
      },
      T0 + DAYS(3),
      true,
    );
    expect(written.rejected).toBeDefined();
  });
});

describe("each approval is one person's, within their limit, for this payment", () => {
  it("counts the creator with no limit", async () => {
    const t = await town();
    const payout = await withPayout(t);
    const creator = await approve(t, t.creator, payout, TERMS, T0 + DAYS(3));
    expect(creator.rejected).toBeUndefined();
    await t.sync();
    await t.community.space.update();
    expect(await t.community.space.view.get(approvalKey(payout, t.creator.did))).toBeDefined();
  });

  it("counts a co-treasurer approving within their limit", async () => {
    const t = await town();
    const co = await phone();
    const coTown = await t.admit(co);
    await grantCoTreasurer(t, co, coTown, rand(1000));
    const payout = await withPayout(t);
    const written = await approve(t, co, payout, TERMS, T0 + DAYS(3));
    expect(written.rejected).toBeUndefined();
  });

  it("refuses an approver over their limit, with the plain reason", async () => {
    const t = await town();
    const co = await phone();
    const coTown = await t.admit(co);
    await grantCoTreasurer(t, co, coTown, rand(1000));
    const payout = await withPayout(t, T0 + DAYS(3), 150000);
    const over = await approve(t, co, payout, { ...TERMS, amountMinor: 150000 }, T0 + DAYS(3));
    expect(over.rejected).toBe("That is above your limit of R1000.");
  });

  it("refuses a member with no role, so nothing counts", async () => {
    const t = await town();
    const m = await phone();
    const mt = await t.admit(m);
    const payout = await withPayout(t);
    const written = await approve(t, m, payout, TERMS, T0 + DAYS(3));
    expect(written.rejected).toBeDefined();
    expect(written.rejected).not.toBe("");
    void mt;
  });

  it("refuses a co-treasurer whose role has ended at log time", async () => {
    const t = await town();
    const co = await phone();
    const coTown = await t.admit(co);
    await grantCoTreasurer(t, co, coTown, rand(1000), 7);
    const payout = await withPayout(t, T0 + DAYS(10));
    const written = await approve(t, co, payout, TERMS, T0 + DAYS(10));
    expect(written.rejected).toMatch(/^Your role ended on /);
  });

  it("refuses a co-treasurer whose role was taken back", async () => {
    const t = await town();
    const co = await phone();
    const coTown = await t.admit(co);
    await grantCoTreasurer(t, co, coTown, rand(1000));
    await recordAt(t, T0 + DAYS(3));
    await write(
      t.community.space,
      t.key,
      "role.revoked",
      t.creator.did,
      { role: "co-treasurer", grantee: co.did },
      T0 + DAYS(3),
    );
    await t.sync();
    const payout = await withPayout(t);
    const written = await approve(t, co, payout, TERMS, T0 + DAYS(3));
    expect(written.rejected).toBe("This role has been taken back.");
  });

  it("counts one person once: a second approval from the same person is refused", async () => {
    const t = await town();
    const payout = await withPayout(t);
    expect((await approve(t, t.creator, payout, TERMS, T0 + DAYS(3))).rejected).toBeUndefined();
    const again = await approve(t, t.creator, payout, TERMS, T0 + DAYS(3));
    expect(again.rejected).toBe("You have already approved this payment.");
    await t.community.space.update();
    expect(await t.community.space.view.list(`approvals/${payout}/`)).toHaveLength(1);
  });

  it("does not count the same signed approval twice when it is sent again", async () => {
    const t = await town();
    const payout = await withPayout(t);
    const signed = await t.creator.auth.sign(
      t.creator.did,
      approvalBytes(t.key, payout, t.creator.did, TERMS),
    );
    if (!signed.ok) throw new Error("sign failed");
    const payload = {
      payout,
      order: ORDER,
      supplier: SUPPLIER,
      amount: { currency: "ZAR", minor: 50000 },
      bank: BANK,
      signature: signed.value,
    };
    const first = await write(
      t.community.space,
      t.key,
      "payment.approved",
      t.creator.did,
      payload,
      T0 + DAYS(3),
    );
    const second = await write(
      t.community.space,
      t.key,
      "payment.approved",
      t.creator.did,
      payload,
      T0 + DAYS(3),
    );
    expect(first.rejected).toBeUndefined();
    expect(second.rejected).toBeDefined();
    await t.community.space.update();
    expect(await t.community.space.view.list(`approvals/${payout}/`)).toHaveLength(1);
  });

  it("refuses an approval signed for another community, even when placed in this one", async () => {
    const t = await town();
    const payout = await withPayout(t);
    const written = await approve(t, t.creator, payout, TERMS, T0 + DAYS(3), {
      space: "ef".repeat(32),
    });
    expect(written.rejected).toBe("This approval isn't signed by the person it names.");
  });

  it("refuses an approval signed by someone else for the approver", async () => {
    const t = await town();
    const co = await phone();
    const coTown = await t.admit(co);
    await grantCoTreasurer(t, co, coTown, rand(1000));
    const impostor = await phone();
    const payout = await withPayout(t);
    const written = await approve(t, co, payout, TERMS, T0 + DAYS(3), { signer: impostor });
    expect(written.rejected).toBe("This approval isn't signed by the person it names.");
  });

  it("refuses an approval whose amount is not the payment's amount", async () => {
    const t = await town();
    const payout = await withPayout(t);
    const written = await approve(
      t,
      t.creator,
      payout,
      { ...TERMS, amountMinor: 49900 },
      T0 + DAYS(3),
    );
    expect(written.rejected).toBe("This approval is for a different payment.");
  });

  it("refuses an approval for a payment the record does not hold", async () => {
    const t = await town();
    const written = await approve(t, t.creator, "ab".repeat(64), TERMS, T0 + DAYS(3));
    expect(written.rejected).toBe("This payment is not in the record.");
  });
});

/** Gives `co` the co-treasurer role with a limit for `days`, from the creator, then syncs. */
async function grantCoTreasurer(
  t: Town,
  co: Phone,
  coTown: Community,
  limit: { currency: "ZAR"; minor: number },
  days = 30,
) {
  const at = T0 + DAYS(2);
  await recordAt(t, at);
  const granted = await t.community.grantRole(co.did, "co-treasurer", { limit, days }, at);
  if (!granted.ok) throw new Error(granted.error.message);
  await t.sync();
  void coTown;
}

describe("an approval names the payment it approves, in every field [S-4.7 gaps]", () => {
  it("refuses an approval whose supplier differs from the recorded payment's", async () => {
    const t = await town();
    const payout = await withPayout(t);
    const written = await approve(
      t,
      t.creator,
      payout,
      { ...TERMS, supplier: "Spar Depot" },
      T0 + DAYS(3),
    );
    expect(written.rejected).toBe("This approval is for a different payment.");
  });

  it("refuses an approval whose order differs from the recorded payment's", async () => {
    const t = await town();
    const payout = await withPayout(t);
    const written = await approve(
      t,
      t.creator,
      payout,
      { ...TERMS, order: "Other order" },
      T0 + DAYS(3),
    );
    expect(written.rejected).toBe("This approval is for a different payment.");
  });

  it("refuses an approval for the old bank details after they are recorded differently", async () => {
    const t = await town();
    const payout = await withPayout(t);
    const written = await approve(
      t,
      t.creator,
      payout,
      { ...TERMS, bank: "34".repeat(64) },
      T0 + DAYS(3),
    );
    expect(written.rejected).toBe("This approval is for a different payment.");
  });
});
