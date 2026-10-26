// A quote saved on a phone with a Node reaches the Node's record (story 6.8 on 4.7's payout path). Before this, the quote
// was written only to the phone's in-memory copy, so the Node never had it and every payment for that supplier was
// refused with "There is no quote from that supplier for this order." These tests pin the event the phone sends and the
// list the Orders screen reads from the synced view.
import { quoteKey, quoteJson, checkQuote } from "@shopong/community";
import { parseEvent } from "@shopong/events";
import type { Did, JsonValue } from "@shopong/ports";
import { describe, expect, it } from "vite-plus/test";
import { quoteEventOf, quotesOfView, quotesToShow } from "./quotes";

const ME = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK" as Did;
const COMMUNITY = "ab".repeat(32);
const randomBytes = (n: number) => new Uint8Array(n).fill(9);

const input = {
  supplier: "Acme",
  order: "pay1",
  lines: [{ item: "Maize meal", unit: "pack", packSize: 1, pricePerPackCents: 10000 }],
  delivery: { feeCents: 0, days: 0 },
};

describe("the quote the phone sends", () => {
  it("is a quote.added event for this community, from the treasurer, that the record accepts", () => {
    const made = quoteEventOf({
      community: COMMUNITY,
      me: ME,
      now: 1_793_000_000_000,
      randomBytes,
      input,
    });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.value.type).toBe("quote.added");
    expect(made.value.space).toBe(COMMUNITY);
    expect(made.value.actor).toBe(ME);
    expect(parseEvent(made.value).ok).toBe(true);
    const checked = checkQuote(input);
    if (!checked.ok) throw new Error("fixture");
    expect(made.value.payload).toEqual(quoteJson(checked.value));
  });

  it("refuses a quote the form would refuse, before anything is sent", () => {
    const made = quoteEventOf({
      community: COMMUNITY,
      me: ME,
      now: 1,
      randomBytes,
      input: { ...input, supplier: "" },
    });
    expect(made.ok).toBe(false);
  });
});

describe("the quotes the Orders screen reads from the synced view", () => {
  it("lists the quotes for one order from the Node's view, tidied the same way the payment is", () => {
    const quote = checkQuote(input);
    if (!quote.ok) throw new Error("fixture");
    const view = new Map<string, JsonValue>([
      [quoteKey("pay1", "Acme"), quoteJson(quote.value)],
      [quoteKey("other", "Spar"), quoteJson({ ...quote.value, order: "other", supplier: "Spar" })],
    ]);
    const listed = quotesOfView(view, "pay1");
    expect(listed.map((q) => q.supplier)).toEqual(["Acme"]);
  });
});

// The list the Orders screen shows is the synced view plus this phone's own saved quotes that the Node has not yet
// pulled back. Before this, a saved quote showed only after a pull, and the list never re-read on a sync change.
describe("what the Orders list shows for a saved quote [S-4.7 quote display]", () => {
  const saved = (supplier: string) => {
    const made = quoteEventOf({
      community: COMMUNITY,
      me: ME,
      now: 1,
      randomBytes,
      input: { ...input, supplier },
    });
    if (!made.ok) throw new Error("fixture");
    return { eventId: `event-${supplier}`, payload: made.value.payload as JsonValue };
  };

  it("shows a quote the treasurer saved before the Node has pulled it back", () => {
    const shown = quotesToShow({ view: new Map(), own: [saved("Acme")], order: "pay1" });
    expect(shown.quotes.map((q) => q.supplier)).toEqual(["Acme"]);
    expect(shown.refusals).toEqual([]);
  });

  it("still shows it, once, after the Node acknowledges it into the view", () => {
    const own = saved("Acme");
    const quote = checkQuote(own.payload);
    if (!quote.ok) throw new Error("fixture");
    const view = new Map<string, JsonValue>([[quoteKey("pay1", "Acme"), quoteJson(quote.value)]]);
    const shown = quotesToShow({ view, own: [own], order: "pay1" });
    expect(shown.quotes.map((q) => q.supplier)).toEqual(["Acme"]);
  });

  it("drops a saved quote the record refused, and says why", () => {
    const own = saved("Acme");
    const view = new Map<string, JsonValue>([
      [
        `rejected/${own.eventId}`,
        { type: "quote.added", reason: "Only the treasurer can add a quote." },
      ],
    ]);
    const shown = quotesToShow({ view, own: [own], order: "pay1" });
    expect(shown.quotes).toEqual([]);
    expect(shown.refusals).toEqual([
      { eventId: own.eventId, reason: "Only the treasurer can add a quote." },
    ]);
  });

  it("leaves a saved quote for another order out of this order's list", () => {
    const shown = quotesToShow({ view: new Map(), own: [saved("Acme")], order: "pay2" });
    expect(shown.quotes).toEqual([]);
  });
});
