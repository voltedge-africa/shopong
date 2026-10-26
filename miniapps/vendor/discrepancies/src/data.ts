// The words and the view model of the discrepancy list (story 10.3). Pure: no React Native here, so it is tested on its
// own. The Node decides every value and every refusal; this only lays out what the Node sent, in plain words.
// SIMULATED payments: nothing here repairs a payment, the books or the record, and the screen says so.

/** One entry as the Node's `GET /communities/:key/discrepancies` sends it. */
export interface RawDiscrepancy {
  readonly id: string;
  readonly kind: string;
  readonly eventId: string;
  readonly text: string;
  /** What the shared record says, as a plain word. */
  readonly record: string;
  /** What the books (ledger) say, as a plain word. */
  readonly books: string;
  /** What the bank (the payment provider) says, as a plain word. */
  readonly provider: string;
  readonly openedAt: number;
  readonly lastSeenAt: number;
  readonly resolution?: { readonly reason: string; readonly at: number; readonly by: string };
}

export interface DiscrepancyResponse {
  readonly open: readonly RawDiscrepancy[];
  readonly resolved: readonly RawDiscrepancy[];
}

export const SIMULATED_NOTE =
  "Simulated payments. Nothing is repaired here: resolving a difference only records your reason.";

export const MAX_REASON_LENGTH = 500;

const TITLES: Readonly<Record<string, string>> = {
  bank_paid_not_in_books: "The bank says paid, but the pool books do not have it",
  bank_paid_not_in_record: "The bank says paid, but the shared record does not show it",
  books_not_in_record: "The pool books have a payment the shared record does not show",
  books_not_paid_at_bank: "The pool books have a payment the bank does not show as paid",
  record_paid_not_at_bank: "The shared record shows paid, but the bank does not",
  bank_failed_not_in_record: "The bank says failed, but the shared record does not show it",
  paid_no_pledge: "The bank says paid, but no pledge matches it",
};

/** The title for a kind the screen knows; any other kind reads as a plain mismatch. */
export function titleOf(kind: string): string {
  return TITLES[kind] ?? "The three records do not agree on this payment";
}

/** The first 12 characters of an event id, then an ellipsis. The full id is kept on the row for copying. */
export function shortEventId(eventId: string): string {
  return eventId.length > 12 ? `${eventId.slice(0, 12)}…` : eventId;
}

export interface DiscrepancyRow {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly eventId: string;
  readonly shortEventId: string;
  /** The three readings, in the order the treasurer compares them. */
  readonly sides: readonly { readonly label: string; readonly value: string }[];
  readonly openedText: string;
  readonly resolutionText?: string;
}

export interface DiscrepancyView {
  readonly summary: string;
  readonly open: readonly DiscrepancyRow[];
  readonly resolved: readonly DiscrepancyRow[];
}

const DAY = 24 * 60 * 60 * 1000;

function rowOf(item: RawDiscrepancy): DiscrepancyRow {
  const days = Math.floor((Date.now() - item.openedAt) / DAY);
  const openedText =
    days <= 0 ? "Found today" : days === 1 ? "Found 1 day ago" : `Found ${days} days ago`;
  return {
    id: item.id,
    title: titleOf(item.kind),
    text: item.text,
    eventId: item.eventId,
    shortEventId: shortEventId(item.eventId),
    sides: [
      { label: "Bank", value: item.provider },
      { label: "Pool books", value: item.books },
      { label: "Shared record", value: item.record },
    ],
    openedText,
    ...(item.resolution === undefined
      ? {}
      : { resolutionText: `Resolved: ${item.resolution.reason}` }),
  };
}

/** Lays out the Node's answer: the summary line, the open entries first, then the resolved ones. */
export function viewOf(response: DiscrepancyResponse): DiscrepancyView {
  const count = response.open.length;
  const summary =
    count === 0
      ? "No open differences. Nothing needs a decision."
      : count === 1
        ? "1 difference needs a decision from a treasurer."
        : `${count} differences need a decision from a treasurer.`;
  return {
    summary,
    open: response.open.map(rowOf),
    resolved: response.resolved.map(rowOf),
  };
}

/** Why a reason cannot be saved, in plain words, or undefined when it can. Trims before it checks. */
export function reasonProblem(reason: string): string | undefined {
  const text = reason.trim();
  if (text === "") return "Write why you are resolving this difference.";
  if (text.length > MAX_REASON_LENGTH) return "Keep the reason under 500 characters.";
  return undefined;
}
