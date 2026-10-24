import type { EpochMs } from "@shopong/ports";

/** What a person reads about a payment, in words. */
export type MoneyState = "requested" | "paid" | "failed" | "refunded";

export const MONEY_STATE_WORDS: Record<MoneyState, string> = {
  requested: "Payment requested",
  paid: "Paid",
  failed: "Payment failed",
  refunded: "Refunded",
};

/**
 * The turning points of the order. The acceptance criterion of story 1.4 is that the app
 * shows `order-proposed`, `pledge-received`, `supplier-paid`, `delivery-planned` and
 * `collection-confirmed` in that order (see `ACCEPTANCE_SEQUENCE`).
 */
export type Milestone =
  | "stokvel-created"
  | "node-authorised"
  | "member-invited"
  | "member-joined"
  | "order-proposed"
  | "order-approved"
  | "quote-added"
  | "quote-selected"
  | "pledge-received"
  | "payment-requested"
  | "payment-received"
  | "payment-failed"
  | "pool-funded"
  | "supplier-approved"
  | "supplier-paid"
  | "driver-assigned"
  | "delivery-planned"
  | "delivery-confirmed"
  | "collection-confirmed"
  | "order-closed";

export const ACCEPTANCE_SEQUENCE: readonly Milestone[] = [
  "order-proposed",
  "pledge-received",
  "supplier-paid",
  "delivery-planned",
  "collection-confirmed",
];

export interface TimelineMoney {
  readonly state: MoneyState;
  readonly amountMinor: number;
  /** For example `R840.00`. */
  readonly amountText: string;
  /** For example `Payment requested`. */
  readonly words: string;
}

export interface TimelineEntry {
  /** 1-based position in the timeline. */
  readonly index: number;
  /** 1-based number of the step that produced it. */
  readonly step: number;
  readonly milestone: Milestone;
  /** The record event this entry shows. */
  readonly eventType: string;
  /** One plain sentence. */
  readonly title: string;
  readonly actorName: string;
  /** For example `Treasurer`, `Member`, `OCN Node`, `Driver`. */
  readonly actorRole: string;
  readonly money?: TimelineMoney;
  /** Full event id (128 hex). Absent for entries derived from the record's state, not from one event. */
  readonly eventId?: string;
  /** First 8 characters of the event id. */
  readonly eventIdShort?: string;
  /** When the writer says it happened. */
  readonly at: EpochMs;
}

/** What a step wants shown for an event it writes. */
export interface EntryDescription {
  readonly milestone: Milestone;
  readonly title: string;
  readonly money?: { readonly state: MoneyState; readonly amountMinor: number };
}
