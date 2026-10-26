// A quote the treasurer saves on a phone with a Node is sent to the Node's record as a `quote.added` event (story 6.8),
// the same way a pledge is. The phone checks the quote with the record's own rules first, so a refused quote is never sent.
// The Orders screen reads the quotes for an order from the synced view, so a quote the Node refused does not show as saved.
import { checkQuote, quoteJson, quoteKey, tidy, type Quote } from "@shopong/community";
import { createEvent, type EventEnvelope } from "@shopong/events";
import type { Did, JsonValue } from "@shopong/ports";

type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problems: readonly string[] };

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** The `quote.added` event for a quote the form typed, or the reasons it cannot be sent. */
export function quoteEventOf(input: {
  readonly community: string;
  readonly me: Did;
  readonly now: number;
  readonly randomBytes: (length: number) => Uint8Array;
  readonly input: unknown;
}): Result<EventEnvelope> {
  const checked = checkQuote(input.input);
  if (!checked.ok) return { ok: false, problems: checked.problems };
  const event = createEvent({
    type: "quote.added",
    space: input.community,
    actor: input.me,
    proof: [],
    claimedAt: input.now,
    nonce: hex(input.randomBytes(16)),
    payload: quoteJson(checked.value),
  } as never) as EventEnvelope;
  return { ok: true, value: event };
}

/** The quotes for one order, as the synced view holds them (the Node's record, or this phone's copy of it). */
export function quotesOfView(
  view: ReadonlyMap<string, JsonValue>,
  order: string,
): readonly Quote[] {
  const prefix = quoteKey(order, "").replace(/\/$/u, "/");
  const out: Quote[] = [];
  for (const [key, value] of view) {
    if (!key.startsWith(prefix)) continue;
    const checked = checkQuote(value);
    if (checked.ok && checked.value.order === tidy(order)) out.push(checked.value);
  }
  return out;
}

/** A quote this phone saved and has queued for the Node, by its event id (the payload is the `quote.added` payload). */
export interface SavedQuote {
  readonly eventId: string;
  readonly payload: JsonValue;
}

/**
 * What the Orders list shows for one order: the quotes the synced view holds, plus this phone's own saved quotes the Node
 * has not confirmed yet (so a saved quote is shown at once). A saved quote the record refused is left out and its reason is
 * returned. A saved quote the view already holds for the same supplier is shown once, from the view.
 */
export function quotesToShow(input: {
  readonly view: ReadonlyMap<string, JsonValue>;
  readonly own: readonly SavedQuote[];
  readonly order: string;
}): {
  readonly quotes: readonly Quote[];
  readonly refusals: readonly { eventId: string; reason: string }[];
} {
  const fromView = quotesOfView(input.view, input.order);
  const have = new Set(fromView.map((quote) => quote.supplier));
  const quotes: Quote[] = [...fromView];
  const refusals: { eventId: string; reason: string }[] = [];
  for (const saved of input.own) {
    const checked = checkQuote(saved.payload);
    if (!checked.ok || checked.value.order !== tidy(input.order)) continue;
    const marker = input.view.get(`rejected/${saved.eventId}`) as { reason?: unknown } | undefined;
    if (typeof marker?.reason === "string") {
      refusals.push({ eventId: saved.eventId, reason: marker.reason });
      continue;
    }
    if (have.has(checked.value.supplier)) continue;
    have.add(checked.value.supplier);
    quotes.push(checked.value);
  }
  return { quotes, refusals };
}
