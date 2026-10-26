import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import { createMemoryRecordNetwork } from "@shopong/adapters-memory";
import { createEvent, webCryptoSha512, type EventEnvelope } from "@shopong/events";
import { money } from "@shopong/ports";
import { describe, expect, it } from "vite-plus/test";
import {
  DAY_MS,
  QUOTE_MESSAGES,
  checkInvitation,
  checkQuote,
  communityDefinition,
  createCommunity,
  joinCommunity,
  quoteKey,
  type CommunityDeps,
} from "./index.js";
import { toHex } from "./space.js";

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

const groceries = {
  supplier: "Mama Thandi Wholesale",
  order: "March groceries",
  lines: [
    { item: "Cooking oil", unit: "bottle", packSize: 6, pricePerPackCents: 14990 },
    { item: "Maize meal", unit: "bag", packSize: 1, pricePerPackCents: 9900 },
    { item: "Sugar", unit: "kg", packSize: 10, pricePerPackCents: 12500 },
  ],
  delivery: { feeCents: 5000, days: 2 },
};

/** A treasurer with a community, and a member who has joined it and so can write to the record. */
async function world() {
  const network = createMemoryRecordNetwork();
  const treasurer = await phone();
  const member = await phone();
  const made = await createCommunity(
    treasurer.deps,
    network.peer<EventEnvelope>(treasurer.did),
    "Ntombi Stokvel",
    T0,
  );
  if (!made.ok) throw new Error(made.error.message);
  const community = made.value;
  const memberSpace = await network
    .peer<EventEnvelope>(member.did)
    .open(community.space.key, communityDefinition(member.deps, treasurer.did, community.key));
  const sync = () => network.replicate<EventEnvelope>(community.space, memberSpace);

  const invitation = await community.invite(member.did, T0);
  if (!invitation.ok) throw new Error(invitation.error.message);
  await sync();
  const checked = await checkInvitation({
    auth: member.auth,
    text: invitation.value.code,
    me: member.did,
    now: T0 + DAY_MS,
    isUsed: async (id) => (await memberSpace.view.get(`joined/${id}`)) !== undefined,
  });
  if (!checked.ok) throw new Error(checked.error.message);
  const joined = await joinCommunity(member.deps, memberSpace, checked.value, T0 + DAY_MS);
  if (!joined.ok) throw new Error(joined.error.message);
  await sync();
  return {
    network,
    treasurer,
    member,
    community,
    memberCommunity: joined.value,
    memberSpace,
    sync,
  };
}

describe("checkQuote", () => {
  it("accepts a complete quote and keeps the values as typed", () => {
    const checked = checkQuote(groceries);
    expect(checked.ok).toBe(true);
    if (checked.ok) expect(checked.value).toEqual(groceries);
  });

  it("accepts free delivery and a same-day delivery", () => {
    expect(checkQuote({ ...groceries, delivery: { feeCents: 0, days: 0 } }).ok).toBe(true);
  });

  it("names the line that has no price", () => {
    const checked = checkQuote({
      ...groceries,
      lines: [groceries.lines[0], { ...groceries.lines[1], pricePerPackCents: undefined }],
    });
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.problems).toEqual(["Line 2 (Maize meal): price missing."]);
  });

  it("refuses a price of zero or below, and a price that is not whole cents", () => {
    const zero = checkQuote({
      ...groceries,
      lines: [{ ...groceries.lines[0], pricePerPackCents: 0 }],
    });
    expect(zero.ok).toBe(false);
    if (!zero.ok)
      expect(zero.problems).toEqual(["Line 1 (Cooking oil): the price must be more than R0.00."]);
    const cents = checkQuote({
      ...groceries,
      lines: [{ ...groceries.lines[0], pricePerPackCents: 149.9 }],
    });
    expect(cents.ok).toBe(false);
    if (!cents.ok)
      expect(cents.problems).toEqual(["Line 1 (Cooking oil): write the price like 125.50."]);
  });

  it("refuses a quote with no lines, and says what else is missing", () => {
    const checked = checkQuote({ ...groceries, lines: [], delivery: {} });
    expect(checked.ok).toBe(false);
    if (!checked.ok)
      expect(checked.problems).toEqual([
        QUOTE_MESSAGES.no_lines,
        QUOTE_MESSAGES.delivery_fee,
        QUOTE_MESSAGES.delivery_days,
      ]);
  });

  it("refuses a phone number as the supplier, and a blank supplier or order", () => {
    expect(checkQuote({ ...groceries, supplier: "082 555 1234" }).ok).toBe(false);
    const blank = checkQuote({ ...groceries, supplier: "  ", order: "" });
    if (!blank.ok)
      expect(blank.problems).toEqual([QUOTE_MESSAGES.no_supplier, QUOTE_MESSAGES.no_order]);
  });

  it("refuses a pack size below one and a missing unit", () => {
    const checked = checkQuote({
      ...groceries,
      lines: [{ ...groceries.lines[1], packSize: 0, unit: " " }],
    });
    if (!checked.ok)
      expect(checked.problems).toEqual([
        "Line 1 (Maize meal): say the unit, for example bag or litre.",
        "Line 1 (Maize meal): the pack size must be a whole number, 1 or more.",
      ]);
    expect(checked.ok).toBe(false);
  });
});

describe("quotes in the community record", () => {
  it("a quote typed by the treasurer shows the same lines, prices and terms on another member's replica", async () => {
    const w = await world();
    const added = await w.community.addQuote(groceries, T0 + 10);
    expect(added.ok).toBe(true);
    await w.sync();
    const mine = await w.community.quotesFor("March groceries");
    const theirs = await w.memberCommunity.quotesFor("March groceries");
    expect(mine).toHaveLength(1);
    expect(theirs).toEqual(mine);
    expect(theirs[0]).toEqual(groceries);
  });

  it("refuses an incomplete quote with the reason, and records nothing", async () => {
    const w = await world();
    const missing = await w.community.addQuote(
      {
        ...groceries,
        lines: [groceries.lines[0], { ...groceries.lines[1], pricePerPackCents: undefined }],
      },
      T0 + 10,
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error.code).toBe("incomplete");
      expect(missing.error.message).toBe("Line 2 (Maize meal): price missing.");
    }
    const none = await w.community.addQuote({ ...groceries, lines: [] }, T0 + 10);
    if (!none.ok) expect(none.error.message).toBe("Add at least one item.");
    await w.sync();
    expect(await w.community.quotesFor("March groceries")).toEqual([]);
    expect(await w.memberCommunity.quotesFor("March groceries")).toEqual([]);
    expect(await w.community.space.view.list("rejected/")).toEqual([]);
  });

  it("refuses a quote from a plain member, both before writing and in apply", async () => {
    const w = await world();
    const direct = await w.memberCommunity.addQuote(groceries, T0 + 10);
    expect(direct.ok).toBe(false);
    if (!direct.ok) {
      expect(direct.error.code).toBe("not_permitted");
      expect(direct.error.message).toBe("Only the treasurer can add a quote.");
    }

    // A member who writes the event anyway is refused by apply, and every replica records the reason.
    const forged = createEvent({
      type: "quote.added",
      space: w.community.key,
      actor: w.member.did,
      proof: [],
      claimedAt: T0 + 10,
      nonce: toHex(randomBytes(16)),
      payload: {
        supplier: groceries.supplier,
        order: groceries.order,
        lines: groceries.lines,
        delivery: groceries.delivery,
      },
    } as never) as EventEnvelope;
    const receipt = await w.memberSpace.append(forged);
    if (!receipt.ok) throw new Error(receipt.error.message);
    await w.sync();
    const rejected = await w.community.space.view.get(`rejected/${receipt.value.id}`);
    expect(rejected).toEqual({ type: "quote.added", reason: QUOTE_MESSAGES.not_permitted });
    expect(await w.community.quotesFor("March groceries")).toEqual([]);
  });

  it("lets a co-treasurer add a quote, and the creator sees it", async () => {
    const w = await world();
    const granted = await w.community.grantRole(
      w.member.did,
      "co-treasurer",
      { limit: money("ZAR", 1_000_000) },
      T0 + 30,
    );
    expect(granted.ok).toBe(true);
    await w.sync();
    const added = await w.memberCommunity.addQuote(groceries, T0 + 40);
    expect(added.ok).toBe(true);
    await w.sync();
    expect(await w.community.quotesFor("March groceries")).toEqual([groceries]);
  });

  it("a newer quote for the same supplier and order replaces the older one", async () => {
    const w = await world();
    await w.community.addQuote(groceries, T0 + 10);
    const newer = {
      ...groceries,
      lines: [{ ...groceries.lines[0], pricePerPackCents: 13990 }],
      delivery: { feeCents: 0, days: 1 },
    };
    const again = await w.community.addQuote(newer, T0 + 20);
    expect(again.ok).toBe(true);
    await w.sync();
    const stored = await w.memberCommunity.quotesFor("March groceries");
    expect(stored).toEqual([newer]);
  });

  it("the same event id twice is one quote, and the receipt says duplicate", async () => {
    const w = await world();
    const event = createEvent({
      type: "quote.added",
      space: w.community.key,
      actor: w.treasurer.did,
      proof: [],
      claimedAt: T0 + 10,
      nonce: toHex(randomBytes(16)),
      payload: {
        supplier: groceries.supplier,
        order: groceries.order,
        lines: groceries.lines,
        delivery: groceries.delivery,
      },
    } as never) as EventEnvelope;
    const first = await w.community.space.append(event);
    const second = await w.community.space.append(event);
    expect(first.ok && first.value.duplicate).toBe(false);
    expect(second.ok && second.value.duplicate).toBe(true);
    await w.sync();
    expect(await w.community.quotesFor("March groceries")).toHaveLength(1);
  });

  it("two replicas that hold the same quotes show the same view, whichever order they arrive in", async () => {
    const w = await world();
    await w.community.addQuote(groceries, T0 + 10);
    await w.community.addQuote(
      { ...groceries, supplier: "Sipho's Cash and Carry", delivery: { feeCents: 0, days: 0 } },
      T0 + 20,
    );
    await w.sync();
    const a = await w.community.quotesFor("March groceries");
    const b = await w.memberCommunity.quotesFor("March groceries");
    expect(a).toHaveLength(2);
    expect(b).toEqual(a);
  });

  it("keys a quote by order and supplier, so the same supplier can quote two orders", async () => {
    const w = await world();
    await w.community.addQuote(groceries, T0 + 10);
    await w.community.addQuote({ ...groceries, order: "April groceries" }, T0 + 20);
    await w.sync();
    expect(await w.memberCommunity.quotesFor("March groceries")).toHaveLength(1);
    expect(await w.memberCommunity.quotesFor("April groceries")).toHaveLength(1);
  });

  it("encodes the order and supplier in the view key, so a slash cannot merge two quotes", () => {
    expect(quoteKey("a/b", "c")).not.toBe(quoteKey("a", "b/c"));
  });
});
