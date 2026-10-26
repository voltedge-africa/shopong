// A bulk order a phone with a Node proposes or approves is sent to the Node's record as an event (story 8.2). These tests
// pin the event the phone sends, the rules it checks first at the record's log time, and what the Orders screen reads
// from the synced view.
import { orderKey, orderIdKey, type StoredOrder } from "@shopong/community";
import { parseEvent } from "@shopong/events";
import type { Did, JsonValue } from "@shopong/ports";
import { describe, expect, it } from "vite-plus/test";
import {
  approveEventOf,
  chooseEventOf,
  gateProblemIn,
  memberCountIn,
  orderEventOf,
  ordersInView,
} from "./orders";

const ME = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK" as Did;
const MEMBER = "did:key:z6MkmtmqQWNzwamfa7QWkNU3Sk2qHpuXK4VrfMXXqVouVZtL";
const COMMUNITY = "ab".repeat(32);
const ID = "cd".repeat(64);
const T0 = 1_793_000_000_000;
const DEADLINE = T0 + 7 * 24 * 60 * 60 * 1000;
const randomBytes = (n: number) => new Uint8Array(n).fill(9);

const proposal = {
  name: "April groceries",
  items: [{ item: "Cooking oil", quantity: 12 }],
  budgetPerMemberMinor: 50_000,
  deadline: DEADLINE,
};

/** A record view as a synced phone holds it: the log time, the members, and the orders on the record. */
function viewWith(entries: Record<string, JsonValue>): Map<string, JsonValue> {
  return new Map(Object.entries({ "log/time": T0, [`members/${ME}`]: {}, ...entries }));
}

const stored: StoredOrder = {
  id: ID,
  name: "April groceries",
  items: [{ item: "Cooking oil", quantity: 12 }],
  budgetPerMemberMinor: 50_000,
  deadline: DEADLINE,
  proposedBy: ME,
  status: "proposed",
};

describe("the proposal the phone sends", () => {
  it("is an order.proposed event the record accepts, with the checked fields", () => {
    const made = orderEventOf({
      community: COMMUNITY,
      me: ME,
      now: T0,
      randomBytes,
      input: proposal,
      view: viewWith({}),
    });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(parseEvent(made.value).ok).toBe(true);
    expect(made.value.type).toBe("order.proposed");
    expect(made.value.payload).toEqual({
      name: "April groceries",
      items: [{ item: "Cooking oil", quantity: 12 }],
      budgetPerMemberMinor: 50_000,
      deadline: DEADLINE,
    });
  });

  it("names what is missing, in plain words, and sends nothing", () => {
    const made = orderEventOf({
      community: COMMUNITY,
      me: ME,
      now: T0,
      randomBytes,
      input: { ...proposal, budgetPerMemberMinor: undefined },
      view: viewWith({}),
    });
    expect(made).toEqual({ ok: false, problems: ["Add a budget per member."] });
  });

  it("refuses a deadline the record has already passed at its log time", () => {
    const made = orderEventOf({
      community: COMMUNITY,
      me: ME,
      now: T0,
      randomBytes,
      input: { ...proposal, deadline: T0 - 1 },
      view: viewWith({}),
    });
    expect(made).toEqual({ ok: false, problems: ["The deadline has already passed."] });
  });

  it("refuses a second order while one is on the record", () => {
    const made = orderEventOf({
      community: COMMUNITY,
      me: ME,
      now: T0,
      randomBytes,
      input: { ...proposal, name: "May groceries" },
      view: viewWith({ [orderKey("April groceries")]: stored as unknown as JsonValue }),
    });
    expect(made).toEqual({ ok: false, problems: ["An order is already open."] });
  });
});

describe("the approval the phone sends", () => {
  it("is an order.approved event that names the proposal by its event id", () => {
    const event = approveEventOf({ community: COMMUNITY, me: ME, now: T0, randomBytes, order: ID });
    expect(event.type).toBe("order.approved");
    expect(event.payload).toEqual({ order: ID });
    expect(parseEvent(event).ok).toBe(true);
  });
});

describe("the choice of a supplier the phone sends (story 8.3)", () => {
  const quote = {
    supplier: "Shop Two",
    order: "April groceries",
    lines: [{ item: "Cooking oil", unit: "bottle", packSize: 12, pricePerPackCents: 30_000 }],
    delivery: { feeCents: 0, days: 5 },
  };
  /** An approved order with one complete quote: 12 bottles from packs of 12 is one pack, 30,000 cents. */
  const approvedView = (status: "open" | "proposed" = "open") =>
    viewWith({
      [`orders/${encodeURIComponent("April groceries")}`]: {
        ...(stored as unknown as Record<string, JsonValue>),
        status,
      },
      [`quotes/${encodeURIComponent("April groceries")}/${encodeURIComponent("Shop Two")}`]: quote,
    });

  it("is a quote.selected event with the total the ranking shows, and the record accepts it", () => {
    const built = chooseEventOf({
      community: COMMUNITY,
      me: ME,
      now: T0,
      randomBytes,
      order: "April groceries",
      supplier: "Shop Two",
      view: approvedView(),
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.type).toBe("quote.selected");
    expect(built.value.payload).toEqual({
      order: "April groceries",
      supplier: "Shop Two",
      totalMinor: 30_000,
    });
    expect(() => parseEvent(built.value)).not.toThrow();
  });

  it("names the reason and sends nothing for an order that is not approved, or has no such quote", () => {
    const notApproved = chooseEventOf({
      community: COMMUNITY,
      me: ME,
      now: T0,
      randomBytes,
      order: "April groceries",
      supplier: "Shop Two",
      view: approvedView("proposed"),
    });
    expect(notApproved).toEqual({ ok: false, problems: ["Approve the order first."] });
    const noQuote = chooseEventOf({
      community: COMMUNITY,
      me: ME,
      now: T0,
      randomBytes,
      order: "April groceries",
      supplier: "Nobody Ltd",
      view: approvedView(),
    });
    expect(noQuote).toEqual({
      ok: false,
      problems: ["No quote from that supplier for this order."],
    });
  });
});

describe("what the Orders screen reads from the synced view", () => {
  it("lists every order on the record, by its stored fields", () => {
    const view = viewWith({
      [orderKey("April groceries")]: stored as unknown as JsonValue,
      [orderIdKey(ID)]: { name: "April groceries" },
    });
    expect(ordersInView(view)).toEqual([stored]);
  });

  it("counts the members in the view", () => {
    const view = viewWith({ [`members/${MEMBER}`]: {} });
    expect(memberCountIn(view)).toBe(2);
  });

  it("holds a quote or a pledge back until the order is open, and after its deadline", () => {
    const proposed = viewWith({ [orderKey("April groceries")]: stored as unknown as JsonValue });
    expect(gateProblemIn(proposed, "April groceries", "quote")).toBe(
      "Quotes open once the treasurer approves the order.",
    );
    expect(gateProblemIn(proposed, "April groceries", "pledge")).toBe(
      "Pledges open once the treasurer approves the order.",
    );
    const open = viewWith({
      [orderKey("April groceries")]: { ...stored, status: "open" } as unknown as JsonValue,
    });
    expect(gateProblemIn(open, "April   groceries", "quote")).toBeUndefined();
    const late = new Map(open);
    late.set("log/time", DEADLINE);
    expect(gateProblemIn(late, "April groceries", "pledge")).toBe(
      "The deadline has already passed.",
    );
  });

  it("holds nothing back for a name with no proposal on the record", () => {
    expect(gateProblemIn(viewWith({}), "March groceries", "quote")).toBeUndefined();
  });
});
