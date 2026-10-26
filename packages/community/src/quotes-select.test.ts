// Choosing a supplier (story 8.3): `quote.selected` names an approved order and a complete quote, and `apply` recomputes
// the total from that quote and the order's wanted items. The matrix rows of the story plan are tested here.
import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import { createMemoryRecordNetwork } from "@shopong/adapters-memory";
import {
  ENVELOPE_VERSION,
  PERSONAL_DATA_MESSAGE,
  createEvent,
  webCryptoSha512,
  type EventEnvelope,
} from "@shopong/events";
import { describe, expect, it } from "vite-plus/test";
import {
  DAY_MS,
  SELECTION_MESSAGES,
  checkInvitation,
  communityDefinition,
  createCommunity,
  joinCommunity,
  rankQuotes,
  selectionKey,
  selectionOf,
  type CommunityDeps,
} from "./index.js";
import { toHex } from "./space.js";

const T0 = 1_793_000_000_000;
const DEADLINE = T0 + 7 * DAY_MS;

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

async function phone() {
  const auth = new IsoUcanCapabilityAuth();
  const did = await auth.createIdentity();
  const deps: CommunityDeps = { auth, sha512: webCryptoSha512, randomBytes };
  return { auth, did, deps };
}

const proposal = {
  name: "April groceries",
  items: [
    { item: "Cooking oil", quantity: 12 },
    { item: "Maize meal", quantity: 4 },
  ],
  budgetPerMemberMinor: 50_000,
  deadline: DEADLINE,
};

/** Two complete quotes. Thandi: oil 2 packs (29,980) + maize 39,600 + fee 5,000 = 74,580. Shop Two: 30,000 + 40,000 + 0 = 70,000. */
const thandi = {
  supplier: "Mama Thandi Wholesale",
  order: "April groceries",
  lines: [
    { item: "Cooking oil", unit: "bottle", packSize: 6, pricePerPackCents: 14990 },
    { item: "Maize meal", unit: "bag", packSize: 1, pricePerPackCents: 9900 },
  ],
  delivery: { feeCents: 5000, days: 2 },
};
const shopTwo = {
  supplier: "Shop Two",
  order: "April groceries",
  lines: [
    { item: "Cooking oil", unit: "bottle", packSize: 12, pricePerPackCents: 30000 },
    { item: "Maize meal", unit: "bag", packSize: 5, pricePerPackCents: 40000 },
  ],
  delivery: { feeCents: 0, days: 5 },
};

/** A treasurer's community with one joined member, both replicas on one in-memory record. */
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
  return { treasurer, member, community, memberSpace, sync };
}

type World = Awaited<ReturnType<typeof world>>;

/** Writes a raw event as `actor`; returns its id and the plain reason it was refused, if it was. */
async function write(
  w: World,
  actor: "treasurer" | "member",
  type: string,
  payload: unknown,
  claimedAt: number,
): Promise<{ id: string; reason: string | undefined }> {
  const who = actor === "treasurer" ? w.treasurer : w.member;
  const space = actor === "treasurer" ? w.community.space : w.memberSpace;
  const event = createEvent({
    type,
    space: w.community.key,
    actor: who.did,
    proof: [],
    claimedAt,
    nonce: toHex(randomBytes(16)),
    payload,
  } as never) as EventEnvelope;
  const receipt = await space.append(event);
  if (!receipt.ok) throw new Error(receipt.error.message);
  await w.sync();
  const rejected = (await w.community.space.view.get(`rejected/${receipt.value.id}`)) as
    | { reason?: string }
    | undefined;
  return { id: receipt.value.id, reason: rejected?.reason };
}

/** A proposed and approved order with both quotes recorded. Returns the order's event id. */
async function approvedWithQuotes(w: World): Promise<string> {
  const proposed = await write(w, "treasurer", "order.proposed", proposal, T0 + 1_000);
  if (proposed.reason !== undefined) throw new Error(proposed.reason);
  const approved = await write(
    w,
    "treasurer",
    "order.approved",
    { order: proposed.id },
    T0 + 2_000,
  );
  if (approved.reason !== undefined) throw new Error(approved.reason);
  for (const [i, quote] of [thandi, shopTwo].entries()) {
    const added = await write(w, "treasurer", "quote.added", quote, T0 + 3_000 + i * 1_000);
    if (added.reason !== undefined) throw new Error(added.reason);
  }
  return proposed.id;
}

const select = (supplier: string, totalMinor?: unknown, order = "April groceries") => ({
  order,
  supplier,
  totalMinor: totalMinor === undefined ? 70_000 : totalMinor,
});

describe("choosing a supplier (quote.selected, story 8.3)", () => {
  it("records the chosen supplier with the total recomputed from its quote and the wanted items", async () => {
    const w = await world();
    await approvedWithQuotes(w);
    const chosen = await write(w, "treasurer", "quote.selected", select("Shop Two"), T0 + 6_000);
    expect(chosen.reason).toBeUndefined();
    const stored = await selectionOf(w.community.space.view, "April groceries");
    expect(stored).toMatchObject({
      order: "April groceries",
      supplier: "Shop Two",
      totalMinor: 70_000,
    });
  });

  it("the treasurer's phone chooses a supplier with the same total, and the record keeps it", async () => {
    const w = await world();
    await approvedWithQuotes(w);
    const chosen = await w.community.chooseSupplier("April groceries", "Shop Two", T0 + 6_000);
    expect(chosen.ok).toBe(true);
    expect(await selectionOf(w.community.space.view, "April groceries")).toMatchObject({
      supplier: "Shop Two",
      totalMinor: 70_000,
    });
    const missing = await w.community.chooseSupplier("April groceries", "Nobody Ltd", T0 + 7_000);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.message).toBe(SELECTION_MESSAGES.no_quote);
  });

  it("uses the same total as the ranking the screen shows", async () => {
    const w = await world();
    await approvedWithQuotes(w);
    const ranked = rankQuotes([thandi, shopTwo], proposal.items);
    if (!ranked.ok) throw new Error(ranked.problems.join(" "));
    const row = ranked.value.ranked.find((r) => r.supplier === "Mama Thandi Wholesale");
    await write(
      w,
      "treasurer",
      "quote.selected",
      select("Mama Thandi Wholesale", row?.totalCents),
      T0 + 6_000,
    );
    const stored = await selectionOf(w.community.space.view, "April groceries");
    expect(stored?.totalMinor).toBe(74_580);
  });

  it("refuses a member's choice, in plain words, and records nothing", async () => {
    const w = await world();
    await approvedWithQuotes(w);
    const refused = await write(w, "member", "quote.selected", select("Shop Two"), T0 + 6_000);
    expect(refused.reason).toBe(SELECTION_MESSAGES.not_permitted);
    expect(await selectionOf(w.community.space.view, "April groceries")).toBeUndefined();
  });

  it("refuses a choice for an order that is not approved yet", async () => {
    const w = await world();
    await write(w, "treasurer", "order.proposed", proposal, T0 + 1_000);
    await write(w, "treasurer", "quote.added", thandi, T0 + 2_000);
    await write(w, "treasurer", "quote.added", shopTwo, T0 + 3_000);
    const refused = await write(w, "treasurer", "quote.selected", select("Shop Two"), T0 + 4_000);
    expect(refused.reason).toBe(SELECTION_MESSAGES.not_approved);
    expect(refused.reason).toBe("Approve the order first.");
  });

  it("refuses a choice for an order name that is not on the record", async () => {
    const w = await world();
    await approvedWithQuotes(w);
    const refused = await write(
      w,
      "treasurer",
      "quote.selected",
      select("Shop Two", 70_000, "No such order"),
      T0 + 6_000,
    );
    expect(refused.reason).toBe("This order is not on the record.");
  });

  it("refuses a supplier with no quote for the order, in plain words", async () => {
    const w = await world();
    await approvedWithQuotes(w);
    const refused = await write(w, "treasurer", "quote.selected", select("Nobody Ltd"), T0 + 6_000);
    expect(refused.reason).toBe(SELECTION_MESSAGES.no_quote);
    expect(refused.reason).toBe("No quote from that supplier for this order.");
  });

  it("refuses a supplier whose quote misses a wanted item, so it cannot be chosen", async () => {
    const w = await world();
    const proposed = await write(w, "treasurer", "order.proposed", proposal, T0 + 1_000);
    await write(w, "treasurer", "order.approved", { order: proposed.id }, T0 + 2_000);
    const partial = { ...shopTwo, supplier: "Half Shop", lines: [shopTwo.lines[0]!] };
    await write(w, "treasurer", "quote.added", partial, T0 + 3_000);
    const refused = await write(w, "treasurer", "quote.selected", select("Half Shop"), T0 + 4_000);
    expect(refused.reason).toBe(SELECTION_MESSAGES.incomplete);
  });

  it("the latest selection stands; the earlier one stays in the log", async () => {
    const w = await world();
    await approvedWithQuotes(w);
    const first = await write(
      w,
      "treasurer",
      "quote.selected",
      select("Mama Thandi Wholesale", 74_580),
      T0 + 6_000,
    );
    const second = await write(w, "treasurer", "quote.selected", select("Shop Two"), T0 + 7_000);
    expect(first.reason).toBeUndefined();
    expect(second.reason).toBeUndefined();
    const stored = await selectionOf(w.community.space.view, "April groceries");
    expect(stored).toMatchObject({ supplier: "Shop Two", totalMinor: 70_000 });
    expect(await w.community.space.view.get(`rejected/${first.id}`)).toBeUndefined();
  });

  it("refuses a total that is not a whole number of cents when the choice is made, and keeps the earlier selection", async () => {
    const w = await world();
    await approvedWithQuotes(w);
    await write(w, "treasurer", "quote.selected", select("Shop Two"), T0 + 6_000);
    // The strict form is checked when the event is made, so a bad total never reaches the log. A float or an unsafe
    // integer is refused by the canonical layer; a text, a negative or a missing total by the registry's validator.
    for (const bad of [40_000.5, "70000", -1, null, Number.MAX_SAFE_INTEGER + 2]) {
      expect(() =>
        createEvent({
          type: "quote.selected",
          space: w.community.key,
          actor: w.treasurer.did,
          proof: [],
          claimedAt: T0 + 7_000,
          nonce: toHex(randomBytes(16)),
          payload: select("Mama Thandi Wholesale", bad),
        } as never),
      ).toThrow();
    }
    const stored = await selectionOf(w.community.space.view, "April groceries");
    expect(stored).toMatchObject({ supplier: "Shop Two", totalMinor: 70_000 });
  });

  it("ignores a claimed total that does not match the recomputed one, and records the recomputed total", async () => {
    const w = await world();
    await approvedWithQuotes(w);
    const claimed = await write(
      w,
      "treasurer",
      "quote.selected",
      select("Shop Two", 1_000),
      T0 + 6_000,
    );
    expect(claimed.reason).toBeUndefined();
    const stored = await selectionOf(w.community.space.view, "April groceries");
    expect(stored?.totalMinor).toBe(70_000);
  });

  it("keys the selection by the order's tidied name", async () => {
    expect(selectionKey("  April   groceries ")).toBe(selectionKey("April groceries"));
    expect(selectionKey("April groceries")).not.toBe(selectionKey("April groceries 2"));
  });

  it("refuses a selection that names a personal number, in the same words as the other records", async () => {
    const w = await world();
    await approvedWithQuotes(w);
    const refused = await write(
      w,
      "treasurer",
      "quote.selected",
      select("Shop Two 0821234567"),
      T0 + 6_000,
    );
    expect(refused.reason).toBeDefined();
    expect(refused.reason).not.toContain("0821234567");
  });
});

/**
 * A `quote.selected` written as a raw envelope, not through `createEvent`, so the shape the record itself checks is what is
 * tested (as the delivery and log-time rows do). Returns the id, the plain reason refused (if any) and what the view holds
 * for the order's selection afterwards.
 */
async function writeRawSelection(w: World, payload: unknown) {
  const event = {
    v: ENVELOPE_VERSION,
    type: "quote.selected",
    space: w.community.key,
    actor: w.treasurer.did,
    proof: [],
    claimedAt: T0 + 6_000,
    nonce: toHex(randomBytes(16)),
    payload,
  } as unknown as EventEnvelope;
  const receipt = await w.community.space.append(event);
  if (!receipt.ok) throw new Error(receipt.error.message);
  await w.sync();
  const rejected = (await w.community.space.view.get(`rejected/${receipt.value.id}`)) as
    | { reason?: unknown }
    | undefined;
  return {
    id: receipt.value.id,
    reason: typeof rejected?.reason === "string" ? rejected.reason : undefined,
    stored: await selectionOf(w.community.space.view, "April groceries"),
  };
}

describe("a malformed quote.selected written straight to the record (story 8.3)", () => {
  it("a well-formed raw choice is accepted, so the raw path itself is sound", async () => {
    const w = await world();
    await approvedWithQuotes(w);
    const written = await writeRawSelection(w, select("Shop Two"));
    expect(written.reason).toBeUndefined();
    expect(written.stored).toMatchObject({ supplier: "Shop Two", totalMinor: 70_000 });
  });

  it.each([
    ["a missing supplier", { order: "April groceries", totalMinor: 70_000 }],
    ["an empty supplier", { order: "April groceries", supplier: "", totalMinor: 70_000 }],
    ["a supplier that is not text", { order: "April groceries", supplier: 42, totalMinor: 70_000 }],
    ["an order that is not text", { order: 7, supplier: "Shop Two", totalMinor: 70_000 }],
    [
      "an extra key",
      { order: "April groceries", supplier: "Shop Two", totalMinor: 70_000, note: "cheapest" },
    ],
    ["a negative total", { order: "April groceries", supplier: "Shop Two", totalMinor: -1 }],
    [
      "a fractional total",
      { order: "April groceries", supplier: "Shop Two", totalMinor: 70_000.5 },
    ],
    ["a missing total", { order: "April groceries", supplier: "Shop Two" }],
  ])("refuses %s in plain words and stores nothing", async (_label, payload) => {
    const w = await world();
    await approvedWithQuotes(w);
    const written = await writeRawSelection(w, payload);
    expect(written.reason).toBe(SELECTION_MESSAGES.unreadable);
    expect(written.stored).toBeUndefined();
    expect(await w.community.space.view.get(`rejected/${written.id}`)).toBeDefined();
  });

  it("refuses a supplier name holding a phone number, and stores nothing under the order", async () => {
    const w = await world();
    await approvedWithQuotes(w);
    const written = await writeRawSelection(w, select("Shop Two 0821234567"));
    expect(written.reason).toBe(PERSONAL_DATA_MESSAGE);
    expect(written.reason).not.toContain("0821234567");
    expect(written.stored).toBeUndefined();
  });

  it("a refused malformed choice leaves an earlier accepted choice in place", async () => {
    const w = await world();
    await approvedWithQuotes(w);
    await writeRawSelection(w, select("Shop Two"));
    const written = await writeRawSelection(w, { ...select("Shop Two"), totalMinor: -5 });
    expect(written.reason).toBe(SELECTION_MESSAGES.unreadable);
    expect(written.stored).toMatchObject({ supplier: "Shop Two", totalMinor: 70_000 });
  });
});
