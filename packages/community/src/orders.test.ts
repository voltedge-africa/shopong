import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import { createMemoryRecordNetwork } from "@shopong/adapters-memory";
import { createEvent, webCryptoSha512, type EventEnvelope } from "@shopong/events";
import { describe, expect, it } from "vite-plus/test";
import {
  DAY_MS,
  ORDER_MESSAGES,
  QUOTE_MESSAGES,
  checkInvitation,
  checkOrder,
  communityDefinition,
  createCommunity,
  joinCommunity,
  orderKey,
  orderIdKey,
  orderGateProblem,
  storedOrderOf,
  type CommunityDeps,
  type StoredOrder,
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

const quote = {
  supplier: "Mama Thandi Wholesale",
  order: "April groceries",
  lines: [
    { item: "Cooking oil", unit: "bottle", packSize: 6, pricePerPackCents: 14990 },
    { item: "Maize meal", unit: "bag", packSize: 1, pricePerPackCents: 9900 },
  ],
  delivery: { feeCents: 5000, days: 2 },
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

type World = Awaited<ReturnType<typeof world>>;

/** Writes a raw event as `actor` and returns the id it was given and the reason it was refused, if it was. */
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

async function proposeAsTreasurer(w: World, at = T0): Promise<string> {
  const made = await write(w, "treasurer", "order.proposed", proposal, at);
  if (made.reason !== undefined) throw new Error(made.reason);
  await w.sync();
  return made.id;
}

describe("checkOrder", () => {
  it("accepts a complete proposal and keeps the items in one fixed order", () => {
    const checked = checkOrder(proposal, T0);
    expect(checked.ok).toBe(true);
    if (checked.ok) {
      expect(checked.value).toEqual({
        name: "April groceries",
        items: [
          { item: "Cooking oil", quantity: 12 },
          { item: "Maize meal", quantity: 4 },
        ],
        budgetPerMemberMinor: 50_000,
        deadline: DEADLINE,
      });
    }
  });

  it("names a missing budget and a missing deadline", () => {
    const noBudget = checkOrder({ ...proposal, budgetPerMemberMinor: undefined }, T0);
    expect(noBudget).toEqual({ ok: false, problems: [ORDER_MESSAGES.no_budget] });
    const noDeadline = checkOrder({ ...proposal, deadline: undefined }, T0);
    expect(noDeadline).toEqual({ ok: false, problems: [ORDER_MESSAGES.no_deadline] });
  });

  it("refuses a deadline that is not after log time", () => {
    expect(checkOrder({ ...proposal, deadline: T0 }, T0)).toEqual({
      ok: false,
      problems: [ORDER_MESSAGES.deadline_passed],
    });
    expect(checkOrder({ ...proposal, deadline: T0 + 1 }, T0)).toMatchObject({ ok: true });
  });

  it("refuses a budget of zero, one that is not whole cents, and one over R100,000.00", () => {
    expect(checkOrder({ ...proposal, budgetPerMemberMinor: 0 }, T0)).toEqual({
      ok: false,
      problems: [ORDER_MESSAGES.budget_zero],
    });
    expect(checkOrder({ ...proposal, budgetPerMemberMinor: 500.5 }, T0)).toEqual({
      ok: false,
      problems: [ORDER_MESSAGES.budget_whole],
    });
    expect(checkOrder({ ...proposal, budgetPerMemberMinor: 10_000_001 }, T0)).toEqual({
      ok: false,
      problems: [ORDER_MESSAGES.budget_max],
    });
  });

  it("refuses a phone number or an ID number in the order name, with a plain reason", () => {
    const phoneName = checkOrder({ ...proposal, name: "Call 082 555 1234" }, T0);
    expect(phoneName).toEqual({ ok: false, problems: [QUOTE_MESSAGES.order_phone] });
    const idName = checkOrder({ ...proposal, name: "April 8001015009087" }, T0);
    expect(idName.ok).toBe(false);
    if (!idName.ok) expect(idName.problems).toEqual([QUOTE_MESSAGES.order_phone]);
  });

  it("refuses a phone number in an item name", () => {
    const checked = checkOrder(
      { ...proposal, items: [{ item: "Call 082 555 1234", quantity: 1 }] },
      T0,
    );
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.problems).toEqual([QUOTE_MESSAGES.item_phone]);
  });

  it("refuses an order with no name and no items", () => {
    expect(checkOrder({ ...proposal, name: "  " }, T0)).toEqual({
      ok: false,
      problems: [ORDER_MESSAGES.no_name],
    });
    expect(checkOrder({ ...proposal, items: [] }, T0)).toEqual({
      ok: false,
      problems: ["Add the items the order needs."],
    });
  });
});

describe("orderGateProblem", () => {
  const stored: StoredOrder = {
    id: "ab".repeat(64),
    name: "April groceries",
    items: [],
    budgetPerMemberMinor: 50_000,
    deadline: DEADLINE,
    proposedBy: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
    status: "proposed",
  };

  it("says nothing for a name with no proposal, so older orders keep working", () => {
    expect(orderGateProblem(undefined, "quote", T0)).toBeUndefined();
    expect(orderGateProblem(undefined, "pledge", T0)).toBeUndefined();
  });

  it("refuses quotes and pledges until the treasurer approves", () => {
    expect(orderGateProblem(stored, "quote", T0)).toBe(ORDER_MESSAGES.quotes_not_open);
    expect(orderGateProblem(stored, "pledge", T0)).toBe(ORDER_MESSAGES.pledges_not_open);
    expect(orderGateProblem({ ...stored, status: "open" }, "quote", T0)).toBeUndefined();
  });

  it("refuses quotes and pledges once log time reaches the deadline", () => {
    const open = { ...stored, status: "open" as const };
    expect(orderGateProblem(open, "quote", DEADLINE - 1)).toBeUndefined();
    expect(orderGateProblem(open, "quote", DEADLINE)).toBe(ORDER_MESSAGES.deadline_passed);
    expect(orderGateProblem(open, "pledge", DEADLINE)).toBe(ORDER_MESSAGES.deadline_passed);
  });
});

describe("proposing an order on the record", () => {
  it("records one order under its tidied name, with the proposal's event id as its identity", async () => {
    const w = await world();
    const id = await proposeAsTreasurer(w);
    const stored = storedOrderOf(await w.memberSpace.view.get(orderKey("April groceries")));
    expect(stored).toEqual({
      id,
      name: "April groceries",
      items: proposal.items,
      budgetPerMemberMinor: 50_000,
      deadline: DEADLINE,
      proposedBy: w.treasurer.did,
      status: "proposed",
    });
    expect(await w.memberSpace.view.get(orderIdKey(id))).toEqual({ name: "April groceries" });
  });

  it("lets any joined member propose, and both replicas hold the same order", async () => {
    const w = await world();
    const made = await write(w, "member", "order.proposed", proposal, T0 + 1);
    expect(made.reason).toBeUndefined();
    await w.sync();
    const fromTreasurer = await w.community.space.view.get(orderKey("April groceries"));
    const fromMember = await w.memberSpace.view.get(orderKey("April groceries"));
    expect(fromMember).toEqual(fromTreasurer);
    expect(storedOrderOf(fromMember)?.proposedBy).toBe(w.member.did);
  });

  it("refuses a second open order while one is open, in plain words", async () => {
    const w = await world();
    await proposeAsTreasurer(w);
    const second = await write(
      w,
      "treasurer",
      "order.proposed",
      { ...proposal, name: "May groceries" },
      T0 + 1,
    );
    expect(second.reason).toBe(ORDER_MESSAGES.already_open);
    expect(await w.memberSpace.view.get(orderKey("May groceries"))).toBeUndefined();
  });

  it("records a replayed proposal once", async () => {
    const w = await world();
    const event = createEvent({
      type: "order.proposed",
      space: w.community.key,
      actor: w.treasurer.did,
      proof: [],
      claimedAt: T0,
      nonce: toHex(randomBytes(16)),
      payload: proposal,
    } as never) as EventEnvelope;
    const first = await w.community.space.append(event);
    const again = await w.community.space.append(event);
    expect(first.ok && again.ok).toBe(true);
    if (first.ok && again.ok) expect(again.value.duplicate).toBe(true);
    await w.community.space.update();
    if (first.ok)
      expect(storedOrderOf(await w.community.space.view.get(orderKey("April groceries")))?.id).toBe(
        first.value.id,
      );
  });

  it("refuses a proposal whose name holds a phone number, with the plain reason, not the generic one", async () => {
    const w = await world();
    const made = await write(
      w,
      "treasurer",
      "order.proposed",
      { ...proposal, name: "Call 082 555 1234" },
      T0,
    );
    expect(made.reason).toBe(QUOTE_MESSAGES.order_phone);
  });

  it("writes nothing for a proposal that is not in the strict form", async () => {
    const w = await world();
    expect(() =>
      createEvent({
        type: "order.proposed",
        space: w.community.key,
        actor: w.treasurer.did,
        proof: [],
        claimedAt: T0,
        nonce: toHex(randomBytes(16)),
        payload: { ...proposal, budgetPerMemberMinor: 1.5 },
      } as never),
    ).toThrow();
    expect(await w.community.space.view.get(orderKey("April groceries"))).toBeUndefined();
  });
});

describe("approving an order", () => {
  it("is the treasurer's: a member's approval is refused in plain words", async () => {
    const w = await world();
    const id = await proposeAsTreasurer(w);
    const made = await write(w, "member", "order.approved", { order: id }, T0 + 1);
    expect(made.reason).toBe(ORDER_MESSAGES.approve_not_permitted);
    expect(storedOrderOf(await w.memberSpace.view.get(orderKey("April groceries")))?.status).toBe(
      "proposed",
    );
  });

  it("opens the order: its status is open for every replica", async () => {
    const w = await world();
    const id = await proposeAsTreasurer(w);
    const made = await write(w, "treasurer", "order.approved", { order: id }, T0 + 1);
    expect(made.reason).toBeUndefined();
    await w.sync();
    expect(storedOrderOf(await w.memberSpace.view.get(orderKey("April groceries")))?.status).toBe(
      "open",
    );
  });

  it("refuses an approval for an order that is not on the record", async () => {
    const w = await world();
    const made = await write(w, "treasurer", "order.approved", { order: "cd".repeat(64) }, T0);
    expect(made.reason).toBe(ORDER_MESSAGES.unknown_order);
  });

  it("refuses a second approval of the same order", async () => {
    const w = await world();
    const id = await proposeAsTreasurer(w);
    await write(w, "treasurer", "order.approved", { order: id }, T0 + 1);
    const again = await write(w, "treasurer", "order.approved", { order: id }, T0 + 2);
    expect(again.reason).toBe(ORDER_MESSAGES.already_approved);
  });
});

describe("quotes and pledges wait for the approval", () => {
  it("refuses a quote before the treasurer approves, and records nothing", async () => {
    const w = await world();
    await proposeAsTreasurer(w);
    const made = await write(w, "treasurer", "quote.added", quote, T0 + 1);
    expect(made.reason).toBe(ORDER_MESSAGES.quotes_not_open);
    expect(
      await w.memberSpace.view.get(
        `quotes/${encodeURIComponent(quote.order)}/${encodeURIComponent(quote.supplier)}`,
      ),
    ).toBeUndefined();
  });

  it("refuses a pledge before the treasurer approves, and records nothing", async () => {
    const w = await world();
    await proposeAsTreasurer(w);
    const made = await write(
      w,
      "member",
      "pledge.created",
      { order: "April groceries", member: w.member.did, amount: { currency: "ZAR", minor: 15000 } },
      T0 + 1,
    );
    expect(made.reason).toBe(ORDER_MESSAGES.pledges_not_open);
  });

  it("accepts a quote and a pledge once the order is open", async () => {
    const w = await world();
    const id = await proposeAsTreasurer(w);
    await write(w, "treasurer", "order.approved", { order: id }, T0 + 1);
    const quoted = await write(w, "treasurer", "quote.added", quote, T0 + 2);
    expect(quoted.reason).toBeUndefined();
    const pledged = await write(
      w,
      "member",
      "pledge.created",
      { order: "April groceries", member: w.member.did, amount: { currency: "ZAR", minor: 15000 } },
      T0 + 3,
    );
    expect(pledged.reason).toBeUndefined();
  });

  it("judges the deadline at log time, not at the claim on the event", async () => {
    const w = await world();
    // The member's join has already moved log time to T0 + a day. Log time then rises by at most a day for each event.
    const deadline = T0 + 2 * DAY_MS;
    const made = await write(
      w,
      "treasurer",
      "order.proposed",
      { ...proposal, deadline },
      T0 + DAY_MS,
    );
    expect(made.reason).toBeUndefined();
    await write(w, "treasurer", "order.approved", { order: made.id }, T0 + DAY_MS + 1);
    // The treasurer's event claims a time after the deadline, so log time reaches the deadline.
    await write(
      w,
      "treasurer",
      "community.named",
      { name: "Ntombi Stokvel", rules: "" },
      deadline + 60_000,
    );
    // The member's pledge claims a time before the deadline, but it lands after log time has reached it.
    const late = await write(
      w,
      "member",
      "pledge.created",
      { order: "April groceries", member: w.member.did, amount: { currency: "ZAR", minor: 15000 } },
      deadline - 1,
    );
    expect(late.reason).toBe(ORDER_MESSAGES.deadline_passed);
    const quoted = await write(w, "treasurer", "quote.added", quote, deadline - 1);
    expect(quoted.reason).toBe(ORDER_MESSAGES.deadline_passed);
  });
});

describe("the orders list", () => {
  it("lists every order in the record, for the treasurer and a member alike", async () => {
    const w = await world();
    await proposeAsTreasurer(w);
    const seen = await w.community.orders();
    expect(seen.map((order) => order.name)).toEqual(["April groceries"]);
    const member = await w.memberCommunity.orders();
    expect(member).toEqual(seen);
  });
});
