// The transaction timeline (story 10.2): every step of one member's payment, in plain sentences, read from the record,
// the pool books and any transaction link, joined by event id. A payment is the pledge (`pledge.created`, the member's
// own event); its request (`payment.requested`), its outcome (`payment.completed` or `payment.failed`, the Node's event
// whose external reference is the pledge's event id), the books' posting (keyed by the outcome's event id) and the
// record's copy of that posting (`ledger.posted`, whose `key` is the outcome's event id).
//
// This module does no I/O and never reads the wall clock. The OCN Node gathers the facts (`apps/node`, timeline routes)
// and passes them in; the same facts always give the same timeline. It writes no names, phone numbers, bank details or
// payer references: every sentence holds only the pledge's amount, the words and the event ids.
//
// Agreement. The record, the pool books and the payment outcome are compared for the one payment. A difference is
// never hidden: it is a `disagree` agreement that says both values. Shortcut S-10.2-1: the bank's live status is not read
// here, only the outcome the record holds (the Node writes it from the verified webhook).

/** A record event this timeline shows: its full event id, its time (when it has one), and its amount in cents. */
export interface RecordedEvent {
  readonly eventId: string;
  readonly at?: number;
  readonly minor: number;
}

/** The record's outcome of a payment: the Node's `payment.completed` or `payment.failed`. */
export interface RecordedOutcome extends RecordedEvent {
  readonly status: "completed" | "failed";
}

/** The record's copy of a books posting (`ledger.posted`). `key` is the outcome event id the posting was keyed by. */
export interface RecordedPosting extends RecordedEvent {
  readonly key: string;
}

/** A posting the books hold, keyed by an outcome event id (the ledger's idempotency key). */
export interface BookedPosting {
  readonly key: string;
  readonly minor: number;
}

/** The books, as the Node could read them. Unreadable means nothing is compared, and the timeline says so. */
export type BooksReading =
  | { readonly readable: false }
  | { readonly readable: true; readonly postings: readonly BookedPosting[] };

/** A transaction link to an on-chain proof. Epic 5 writes these; none are read until then (see S-10.2-2). */
export interface TransactionLink {
  readonly eventId: string;
  readonly url: string;
}

/** Everything the timeline of one payment is built from. */
export interface TransactionFacts {
  /** The member's `pledge.created` event: the payment's own id, and its amount. */
  readonly pledge: RecordedEvent;
  /** The Node's `payment.requested` events for this pledge. */
  readonly requests: readonly RecordedEvent[];
  /** The Node's `payment.completed` and `payment.failed` events for this pledge. */
  readonly outcomes: readonly RecordedOutcome[];
  /** The record's `ledger.posted` copies of the postings keyed by an outcome. */
  readonly postings: readonly RecordedPosting[];
  readonly books: BooksReading;
  readonly links?: readonly TransactionLink[];
}

export type TimelineStepKind = "pledged" | "requested" | "confirmed" | "posted" | "link";

export interface TimelineStep {
  readonly kind: TimelineStepKind;
  /** A short label, in the same words as the money states (`Payment requested`, `Paid`, `Payment failed`). */
  readonly label: string;
  /** One plain sentence. */
  readonly words: string;
  /** The full id of the record event this step shows, when it shows one. */
  readonly eventId?: string;
  /** For a posting: the outcome event id it is joined to. */
  readonly joinedTo?: string;
  /** When the record says it happened, when it says. */
  readonly at?: number;
}

export type AgreementState = "agree" | "disagree" | "waiting" | "unchecked";

export interface Agreement {
  readonly state: AgreementState;
  /** One plain sentence, saying what agrees or what differs, with both values when they differ. */
  readonly words: string;
}

export interface Timeline {
  /** The pledge's event id: the payment's join key. */
  readonly pledgeId: string;
  /** In order: pledged, requested, confirmed, posted, then any transaction links. */
  readonly steps: readonly TimelineStep[];
  readonly agreement: Agreement;
}

/** The plain sentences of the timeline. Every amount is written as rand and cents. */
export const TIMELINE_MESSAGES = {
  pledged: "You pledged",
  requested: "Payment of",
  requestedEnd: "requested. You pay it in your banking app.",
  confirmed: "The bank confirmed the payment of",
  failed: "The bank did not take the payment of",
  failedEnd: "You can pledge and pay again.",
  waiting: "Waiting for the bank to confirm the payment.",
  posted: "The pool books recorded",
  postedFrom: "from you.",
  notPosted: "The bank confirmed the payment, but the pool books do not show it yet.",
  booksUnreadable: "The pool books could not be read right now, so they are not checked yet.",
  link: "Transaction link:",
  agreeCompleted: "The record, the bank and the pool books agree on",
  agreeFailed: "The bank did not take the payment, and the pool books show nothing. They agree.",
  agreeWaiting: "Nothing to compare yet: the bank has not confirmed the payment.",
  unchecked:
    "The pool books could not be read right now, so the record and the books are not compared yet.",
  disagreeMissing:
    "The record says the payment was made, but the pool books do not show it yet. Ask the treasurer to check.",
  disagreeFailedPosted:
    "The bank did not take the payment, but the pool books show it. Ask the treasurer to check.",
  disagreeAmounts: "The record says",
  disagreeAmountsBooks: "but the pool books show",
  disagreeAmountsEnd: "Ask the treasurer to check.",
  disagreeNoCopy:
    "The pool books show the payment, but the shared record has no copy of it yet. Ask the treasurer to check.",
  disagreeCopy:
    "The pool books and the shared record show different amounts for the payment. Ask the treasurer to check.",
  disagreePledge:
    "The bank confirmed a different amount from the one you pledged. Ask the treasurer to check.",
} as const;

/** R1.50, R150.00, R0.05: whole cents, exact. */
export function randWords(minor: number): string {
  const rands = Math.floor(minor / 100);
  const cents = minor % 100;
  return `R${rands.toString()}.${cents.toString().padStart(2, "0")}`;
}

function byTime(a: { readonly at?: number }, b: { readonly at?: number }): number {
  return (a.at ?? 0) - (b.at ?? 0);
}

function agreementOf(facts: TransactionFacts, outcome: RecordedOutcome | undefined): Agreement {
  if (!facts.books.readable) {
    return { state: "unchecked", words: TIMELINE_MESSAGES.unchecked };
  }
  const postings = facts.books.postings;
  if (outcome === undefined) {
    return { state: "waiting", words: TIMELINE_MESSAGES.agreeWaiting };
  }
  const booked = postings.find((posting) => posting.key === outcome.eventId);
  if (outcome.status === "failed") {
    return booked === undefined
      ? { state: "agree", words: TIMELINE_MESSAGES.agreeFailed }
      : { state: "disagree", words: TIMELINE_MESSAGES.disagreeFailedPosted };
  }
  if (booked === undefined) {
    return { state: "disagree", words: TIMELINE_MESSAGES.disagreeMissing };
  }
  if (booked.minor !== outcome.minor) {
    return {
      state: "disagree",
      words: `${TIMELINE_MESSAGES.disagreeAmounts} ${randWords(outcome.minor)}, ${TIMELINE_MESSAGES.disagreeAmountsBooks} ${randWords(booked.minor)}. ${TIMELINE_MESSAGES.disagreeAmountsEnd}`,
    };
  }
  if (outcome.minor !== facts.pledge.minor) {
    return { state: "disagree", words: TIMELINE_MESSAGES.disagreePledge };
  }
  const copy = facts.postings.find((posting) => posting.key === outcome.eventId);
  if (copy === undefined) {
    return { state: "disagree", words: TIMELINE_MESSAGES.disagreeNoCopy };
  }
  if (copy.minor !== booked.minor) {
    return { state: "disagree", words: TIMELINE_MESSAGES.disagreeCopy };
  }
  return {
    state: "agree",
    words: `${TIMELINE_MESSAGES.agreeCompleted} ${randWords(outcome.minor)}.`,
  };
}

/**
 * The timeline of one payment. Steps come in order: pledged, requested, confirmed, posted, then links. The first request
 * and the first outcome are the ones shown: a payment is terminal once it has an outcome, and a retry is a new pledge.
 */
export function transactionTimeline(facts: TransactionFacts): Timeline {
  const request = [...facts.requests].sort(byTime)[0];
  const outcome = [...facts.outcomes].sort(byTime)[0];
  const steps: TimelineStep[] = [];

  steps.push({
    kind: "pledged",
    label: "Pledged",
    words: `${TIMELINE_MESSAGES.pledged} ${randWords(facts.pledge.minor)}.`,
    eventId: facts.pledge.eventId,
    ...(facts.pledge.at === undefined ? {} : { at: facts.pledge.at }),
  });

  if (request !== undefined) {
    steps.push({
      kind: "requested",
      label: "Payment requested",
      words: `${TIMELINE_MESSAGES.requested} ${randWords(request.minor)} ${TIMELINE_MESSAGES.requestedEnd}`,
      eventId: request.eventId,
      ...(request.at === undefined ? {} : { at: request.at }),
    });
  }

  if (outcome === undefined) {
    if (request !== undefined) {
      steps.push({ kind: "confirmed", label: "Waiting", words: TIMELINE_MESSAGES.waiting });
    }
  } else if (outcome.status === "completed") {
    steps.push({
      kind: "confirmed",
      label: "Paid",
      words: `${TIMELINE_MESSAGES.confirmed} ${randWords(outcome.minor)}.`,
      eventId: outcome.eventId,
      ...(outcome.at === undefined ? {} : { at: outcome.at }),
    });
    steps.push(postedStep(facts, outcome));
  } else {
    steps.push({
      kind: "confirmed",
      label: "Payment failed",
      words: `${TIMELINE_MESSAGES.failed} ${randWords(outcome.minor)}. ${TIMELINE_MESSAGES.failedEnd}`,
      eventId: outcome.eventId,
      ...(outcome.at === undefined ? {} : { at: outcome.at }),
    });
  }

  for (const link of facts.links ?? []) {
    steps.push({
      kind: "link",
      label: "Transaction link",
      words: `${TIMELINE_MESSAGES.link} ${link.url}`,
      eventId: link.eventId,
    });
  }

  return {
    pledgeId: facts.pledge.eventId,
    steps,
    agreement: agreementOf(facts, outcome),
  };
}

function postedStep(facts: TransactionFacts, outcome: RecordedOutcome): TimelineStep {
  if (!facts.books.readable) {
    return { kind: "posted", label: "Not checked", words: TIMELINE_MESSAGES.booksUnreadable };
  }
  const booked = facts.books.postings.find((posting) => posting.key === outcome.eventId);
  if (booked === undefined) {
    return { kind: "posted", label: "Not in the books yet", words: TIMELINE_MESSAGES.notPosted };
  }
  const copy = facts.postings.find((posting) => posting.key === outcome.eventId);
  return {
    kind: "posted",
    label: "Recorded in the pool books",
    words: `${TIMELINE_MESSAGES.posted} ${randWords(booked.minor)} ${TIMELINE_MESSAGES.postedFrom}`,
    joinedTo: outcome.eventId,
    ...(copy === undefined ? {} : { eventId: copy.eventId }),
    ...(copy?.at === undefined ? {} : { at: copy.at }),
  };
}
