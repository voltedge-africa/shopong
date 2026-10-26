// Pledges (story 4.3): the rules a member's pledge must meet, and what `apply` records for it. Security rows are
// marked [S-4.3]. Each refusal is one plain sentence, as the record shows it.
import { describe, expect, it } from "vite-plus/test";
import {
  createEvent,
  eventIdOf,
  webCryptoSha512,
  type EventEnvelope,
  type EventId,
} from "@shopong/events";
import type { CapabilityAuth, Did, RecordEntry, ViewWriter } from "@shopong/ports";
import { createCommunityApply } from "./apply.js";
import {
  PAYMENT_TYPE_MESSAGE,
  PLEDGE_LIMITS,
  PLEDGE_MESSAGES,
  checkPledge,
  checkPayable,
  pledgeByEvent,
  pledgeOf,
} from "./pledges.js";

const creator = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK" as Did;
const member = "did:key:z6MkmtmqQWNzwamfa7QWkNU3Sk2qHpuXK4VrfMXXqVouVZtL" as Did;
const stranger = "did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH" as Did;
const space = "ab".repeat(32);

const pledge = (over: Record<string, unknown> = {}, amount: Record<string, unknown> = {}) => ({
  order: "March groceries",
  member,
  amount: { currency: "ZAR", minor: 15000, ...amount },
  ...over,
});

describe("the amount rule", () => {
  it("accepts R1.00 and R3,000.00 exactly", () => {
    expect(checkPledge(pledge({}, { minor: 100 })).ok).toBe(true);
    expect(checkPledge(pledge({}, { minor: 300_000 })).ok).toBe(true);
  });

  it("refuses under R1.00 with the plain sentence", () => {
    expect(checkPledge(pledge({}, { minor: 99 }))).toEqual({
      ok: false,
      problem: PLEDGE_MESSAGES.too_small,
    });
    expect(PLEDGE_MESSAGES.too_small).toBe("The smallest payment is R1.00.");
  });

  it("refuses over R3,000.00 with the plain sentence", () => {
    expect(checkPledge(pledge({}, { minor: 300_001 }))).toEqual({
      ok: false,
      problem: PLEDGE_MESSAGES.too_big,
    });
    expect(PLEDGE_MESSAGES.too_big).toBe("That is more than one bank allows in one payment.");
  });

  it("keeps the limits in whole cents", () => {
    expect(PLEDGE_LIMITS).toEqual({ currency: "ZAR", minCents: 100, maxCents: 300_000 });
  });

  it.each([
    ["a decimal", 150.5],
    ["a string", "15000"],
    ["a negative", -100],
  ])("refuses an amount that is %s", (_name, minor) => {
    expect(checkPledge(pledge({}, { minor })).ok).toBe(false);
  });

  it("refuses a currency other than ZAR", () => {
    expect(checkPledge(pledge({}, { currency: "USD" })).ok).toBe(false);
  });
});

describe("[S-4.3] who may pledge", () => {
  it("refuses a pledge made for someone else (wrong actor)", () => {
    // The payload names `member`; a pledge may only be made by that member. Checked here as the actor.
    expect(checkPledge(pledge({ member: stranger }), member)).toEqual({
      ok: false,
      problem: PLEDGE_MESSAGES.wrong_member,
    });
  });

  it("refuses a pledge with no order name", () => {
    expect(checkPledge(pledge({ order: "  " })).ok).toBe(false);
  });
});

describe("[S-4.3] the shape of a pledge and of a payment request", () => {
  it("refuses a pledge with a field the record does not name", () => {
    expect(checkPledge({ ...pledge(), attempt: 2 })).toEqual({
      ok: false,
      problem: PLEDGE_MESSAGES.unknown_field,
    });
  });

  it("refuses an amount with an extra field", () => {
    expect(checkPledge(pledge({}, { rate: 1 })).ok).toBe(false);
  });
});

describe("[S-4.3] who may pay a pledge", () => {
  const recorded = {
    order: "March groceries",
    member,
    minor: 15000,
    event: "ab".repeat(64),
    claimedAt: 1,
  };

  it("refuses a payment for someone else's pledge", () => {
    expect(checkPayable(recorded, stranger)).toBe(PLEDGE_MESSAGES.pay_not_yours);
    expect(PLEDGE_MESSAGES.pay_not_yours).toBe("You can only pay your own pledge.");
  });

  it("allows the member to pay their own pledge in range", () => {
    expect(checkPayable(recorded, member)).toBeUndefined();
  });

  it("refuses a stored pledge whose amount is out of range", () => {
    expect(checkPayable({ ...recorded, minor: 50 }, member)).toBe(PLEDGE_MESSAGES.too_small);
  });
});

// ---- apply: the record side --------------------------------------------------------------

const auth = {
  tokenId: async () => "x",
  verify: async () => ({ ok: false }),
} as unknown as CapabilityAuth;

function memoryView(): ViewWriter & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    async get(key: string) {
      return data.get(key) as never;
    },
    async list(prefix: string) {
      return [...data.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([key, value]) => ({ key, value: value as never }));
    },
    async put(key: string, value: never) {
      data.set(key, value);
    },
    async del(key: string) {
      data.delete(key);
    },
  } as unknown as ViewWriter & { data: Map<string, unknown> };
}

async function eventOf(
  type: "pledge.created" | "payment.requested",
  actor: Did,
  payload: Record<string, unknown>,
  claimedAt = 1793001600000,
): Promise<EventEnvelope> {
  return createEvent({
    space,
    actor,
    proof: [],
    claimedAt,
    nonce: "00".repeat(16),
    type,
    payload,
  } as never) as EventEnvelope;
}

async function entryOf(event: EventEnvelope, writer: Did = event.actor as Did) {
  const id = (await eventIdOf(event, webCryptoSha512)) as EventId;
  return { id, writer, event } as unknown as RecordEntry<EventEnvelope>;
}

/** A community where `member` has joined, the way `apply` records a join. */
async function withMember(view: ReturnType<typeof memoryView>) {
  view.data.set(`members/${member}`, { invitation: "founder", joinedAt: 1 });
  view.data.set(`members/${creator}`, { invitation: "founder", joinedAt: 1 });
}

const host = { addWriter: async () => {}, removeWriter: async () => {} };
const apply = () => createCommunityApply({ auth, creator, spaceKey: space });

describe("[S-4.3] apply records a pledge", () => {
  it("records a member's pledge under the order and under its event id", async () => {
    const view = memoryView();
    await withMember(view);
    const entry = await entryOf(await eventOf("pledge.created", member, pledge()));
    await apply()([entry], view, host);
    expect(view.data.get(`pledges/March%20groceries/${member}`)).toMatchObject({
      order: "March groceries",
      member,
      minor: 15000,
      event: entry.id,
    });
    expect(view.data.get(`pledge-events/${entry.id}`)).toMatchObject({ member, minor: 15000 });
  });

  it("refuses a pledge from someone who is not a member, and records nothing", async () => {
    const view = memoryView();
    await withMember(view);
    const entry = await entryOf(
      await eventOf("pledge.created", stranger, pledge({ member: stranger })),
    );
    await apply()([entry], view, host);
    expect(view.data.get(`rejected/${entry.id}`)).toEqual({
      type: "pledge.created",
      reason: PLEDGE_MESSAGES.not_member,
    });
    expect([...view.data.keys()].some((k) => k.startsWith("pledge"))).toBe(false);
  });

  it("[S-4.3] refuses a pledge whose amount is outside the limits", async () => {
    const view = memoryView();
    await withMember(view);
    const entry = await entryOf(
      await eventOf("pledge.created", member, pledge({}, { minor: 300_001 })),
    );
    await apply()([entry], view, host);
    expect(view.data.get(`rejected/${entry.id}`)).toMatchObject({
      reason: PLEDGE_MESSAGES.too_big,
    });
    expect([...view.data.keys()].some((k) => k.startsWith("pledge-events/"))).toBe(false);
  });

  it("[S-4.3] refuses a pledge naming another member (wrong actor), and records nothing", async () => {
    const view = memoryView();
    await withMember(view);
    const entry = await entryOf(
      await eventOf("pledge.created", member, pledge({ member: creator })),
    );
    await apply()([entry], view, host);
    expect(view.data.get(`rejected/${entry.id}`)).toMatchObject({
      reason: PLEDGE_MESSAGES.wrong_member,
    });
  });

  it("[S-4.3] refuses the same pledge event id twice (duplicate pledge id)", async () => {
    const view = memoryView();
    await withMember(view);
    const event = await eventOf("pledge.created", member, pledge());
    const first = await entryOf(event);
    await apply()([first], view, host);
    // The record keeps one entry per event id, so the second arrival is the same id written again.
    view.data.delete(`rejected/${first.id}`);
    await apply()([first], view, host);
    expect(view.data.get(`rejected/${first.id}`)).toMatchObject({
      reason: PLEDGE_MESSAGES.duplicate,
    });
  });
});

/** The Node's did:key, named in `by` of the payment requests it writes through the creator's replica. */
const NODE_IDENTITY = "did:key:z6MkfrQ7y7N9mWrVHgqZ6nqvpjhiWqwCfsZUYqL4pkoKJ2zL";
const paymentIn = (pledgeEvent: string, extra: Record<string, unknown> = {}) => ({
  direction: "in",
  pledgeEvent,
  amount: { currency: "ZAR", minor: 15000 },
  by: NODE_IDENTITY,
  ...extra,
});

describe("[S-4.3] a phone cannot create a payment request", () => {
  it("refuses a payment.requested written by a member", async () => {
    const view = memoryView();
    await withMember(view);
    const pledgeEntry = await entryOf(await eventOf("pledge.created", member, pledge()));
    await apply()([pledgeEntry], view, host);
    const request = await entryOf(
      await eventOf("payment.requested", member, paymentIn(pledgeEntry.id)),
    );
    await apply()([request], view, host);
    expect(view.data.get(`rejected/${request.id}`)).toMatchObject({ reason: PAYMENT_TYPE_MESSAGE });
    expect(view.data.get(`payments/${pledgeEntry.id}`)).toBeUndefined();
  });

  it("[S-4.3] refuses a payment.requested from someone who is not the creator, member or not", async () => {
    const view = memoryView();
    await withMember(view);
    const pledgeEntry = await entryOf(await eventOf("pledge.created", member, pledge()));
    await apply()([pledgeEntry], view, host);
    const request = await entryOf(
      await eventOf("payment.requested", stranger, paymentIn(pledgeEntry.id)),
    );
    await apply()([request], view, host);
    expect(view.data.get(`rejected/${request.id}`)).toMatchObject({ reason: PAYMENT_TYPE_MESSAGE });
    expect(view.data.get(`payments/${pledgeEntry.id}`)).toBeUndefined();
  });

  it("[S-4.3] refuses a payment request with a payment id in it", async () => {
    const view = memoryView();
    await withMember(view);
    const pledgeEntry = await entryOf(await eventOf("pledge.created", member, pledge()));
    await apply()([pledgeEntry], view, host);
    const request = await entryOf(
      await eventOf(
        "payment.requested",
        creator,
        paymentIn(pledgeEntry.id, { paymentId: "pir_abcdefabcdefabcdef" }),
      ),
    );
    await apply()([request], view, host);
    expect(view.data.get(`rejected/${request.id}`)).toMatchObject({
      reason: PLEDGE_MESSAGES.payment_fields,
    });
    expect(view.data.get(`payments/${pledgeEntry.id}`)).toBeUndefined();
  });

  it("refuses a payment request with no `by`, the Node's identity", async () => {
    const view = memoryView();
    await withMember(view);
    const pledgeEntry = await entryOf(await eventOf("pledge.created", member, pledge()));
    await apply()([pledgeEntry], view, host);
    const { by: _omitted, ...withoutBy } = paymentIn(pledgeEntry.id);
    const request = await entryOf(await eventOf("payment.requested", creator, withoutBy));
    await apply()([request], view, host);
    expect(view.data.get(`rejected/${request.id}`)).toMatchObject({
      reason: PLEDGE_MESSAGES.payment_fields,
    });
  });

  it("[S-4.3] refuses a payment request that is a payout, not a payment in", async () => {
    const view = memoryView();
    await withMember(view);
    const pledgeEntry = await entryOf(await eventOf("pledge.created", member, pledge()));
    await apply()([pledgeEntry], view, host);
    const request = await entryOf(
      await eventOf("payment.requested", creator, paymentIn(pledgeEntry.id, { direction: "out" })),
    );
    await apply()([request], view, host);
    expect(view.data.get(`rejected/${request.id}`)).toMatchObject({
      reason: PLEDGE_MESSAGES.not_pay_in,
    });
  });

  it("[S-4.3] refuses a payment request for an unknown pledge", async () => {
    const view = memoryView();
    await withMember(view);
    const request = await entryOf(
      await eventOf("payment.requested", creator, paymentIn("cd".repeat(64))),
    );
    await apply()([request], view, host);
    expect(view.data.get(`rejected/${request.id}`)).toMatchObject({
      reason: PLEDGE_MESSAGES.unknown_pledge,
    });
  });

  it("[S-4.3] refuses a payment request for a pledge whose member has since been removed", async () => {
    const view = memoryView();
    await withMember(view);
    const pledgeEntry = await entryOf(await eventOf("pledge.created", member, pledge()));
    await apply()([pledgeEntry], view, host);
    view.data.delete(`members/${member}`);
    const request = await entryOf(
      await eventOf("payment.requested", creator, paymentIn(pledgeEntry.id)),
    );
    await apply()([request], view, host);
    expect(view.data.get(`rejected/${request.id}`)).toMatchObject({
      reason: PLEDGE_MESSAGES.pay_no_role,
    });
    expect(view.data.get(`payments/${pledgeEntry.id}`)).toBeUndefined();
  });

  it("[S-4.3] refuses a second payment request for the same pledge (one request per pledge)", async () => {
    const view = memoryView();
    await withMember(view);
    const pledgeEntry = await entryOf(await eventOf("pledge.created", member, pledge()));
    await apply()([pledgeEntry], view, host);
    const first = await entryOf(
      await eventOf("payment.requested", creator, paymentIn(pledgeEntry.id), 1793001600001),
    );
    await apply()([first], view, host);
    const second = await entryOf(
      await eventOf("payment.requested", creator, paymentIn(pledgeEntry.id), 1793001600002),
    );
    await apply()([second], view, host);
    expect(view.data.get(`rejected/${second.id}`)).toMatchObject({
      reason: PLEDGE_MESSAGES.duplicate,
    });
  });

  it("records the Node's request, written as the creator with the Node's `by`, against the pledge it pays", async () => {
    const view = memoryView();
    await withMember(view);
    const pledgeEntry = await entryOf(await eventOf("pledge.created", member, pledge()));
    await apply()([pledgeEntry], view, host);
    const request = await entryOf(
      await eventOf("payment.requested", creator, paymentIn(pledgeEntry.id)),
    );
    await apply()([request], view, host);
    expect(view.data.get(`payments/${pledgeEntry.id}`)).toEqual({ minor: 15000 });
  });
});

describe("reading pledges back", () => {
  it("finds a pledge by its event id and by order and member", async () => {
    const view = memoryView();
    await withMember(view);
    const entry = await entryOf(await eventOf("pledge.created", member, pledge()));
    await apply()([entry], view, host);
    expect(await pledgeByEvent(view, entry.id)).toMatchObject({ member, minor: 15000 });
    expect(await pledgeOf(view, "March groceries", member)).toMatchObject({ event: entry.id });
  });
});
