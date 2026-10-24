import type { Did, EpochMs, EventId, Money, PortError, Result } from "./common.js";

/** Lifecycle of a payment request or payout. Everything but `pending` is terminal. */
export type PaymentStatus = "pending" | "completed" | "cancelled" | "expired" | "failed";

export const TERMINAL_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  "completed",
  "cancelled",
  "expired",
  "failed",
];

/** Maximum lengths the processor accepts (Stitch: payer 12, beneficiary 20, external 4096). */
export const PAYER_REFERENCE_MAX = 12;
export const BENEFICIARY_REFERENCE_MAX = 20;

/** A webhook exactly as received over HTTP. The adapter verifies the signature itself. */
export interface WebhookDelivery {
  /** Header names lowercased. */
  readonly headers: { readonly [name: string]: string };
  readonly body: string;
}

export type WebhookErrorCode =
  /** Signature missing or wrong, or a replayed delivery outside the accepted window. */
  "invalid_signature" | "malformed" | "unknown_payment";

export interface WebhookOutcome<P> {
  readonly payment: P;
  /** False when the payment was already in a terminal state; nothing changed. */
  readonly applied: boolean;
}

export type CreateErrorCode =
  | "invalid_request"
  /** The external reference was used before with a different body. */
  | "idempotency_conflict";

export type PaymentMethod = "eft" | "pay_by_bank" | "card";

export interface PaymentRequestInput {
  /** Strictly positive. */
  readonly amount: Money;
  /** The event id of the pledge; the idempotency and reconciliation key. */
  readonly externalReference: EventId;
  /** Shown on the payer's statement; at most `PAYER_REFERENCE_MAX` characters. */
  readonly payerReference: string;
  /** Shown on the beneficiary's statement; at most `BENEFICIARY_REFERENCE_MAX` characters. */
  readonly beneficiaryReference: string;
  /** After this time the request expires if unpaid. */
  readonly expireAt: EpochMs;
  /** An opaque payer id (never a phone or ID number). */
  readonly payerId?: string;
  /** Defaults to `["eft"]`. */
  readonly methods?: readonly PaymentMethod[];
}

export interface PaymentRequest {
  readonly id: string;
  /** Open in an in-app browser tab, not a WebView (AD-15). */
  readonly url: string;
  readonly status: PaymentStatus;
  readonly amount: Money;
  readonly externalReference: EventId;
  readonly expireAt: EpochMs;
}

/**
 * Collect money from a member into the pool (Stitch pay-ins). Runs on the OCN Node only.
 * Owning epic: 4.
 *
 * Webhooks are the source of truth; redirect parameters are untrusted. Creating twice
 * with the same external reference and body returns the same request. Once a request is
 * terminal its status never changes; later webhooks for it are acknowledged with
 * `applied: false`.
 */
export interface PayIn {
  createRequest(
    input: PaymentRequestInput,
  ): Promise<Result<PaymentRequest, PortError<CreateErrorCode>>>;
  /** Current status by payment id, for the reconciler. Undefined if unknown. */
  getRequest(id: string): Promise<PaymentRequest | undefined>;
  /** Cancel a pending request. Cancelling a terminal one returns it unchanged. */
  cancelRequest(id: string): Promise<Result<PaymentRequest, PortError<"unknown_payment">>>;
  ingestWebhook(
    delivery: WebhookDelivery,
  ): Promise<Result<WebhookOutcome<PaymentRequest>, PortError<WebhookErrorCode>>>;
}

/** Bank details of a supplier. Held only on the OCN Node; never written to the record. */
export interface PayoutBeneficiary {
  readonly name: string;
  /** Processor bank identifier, for example `fnb`. */
  readonly bankId: string;
  readonly accountNumber: string;
  readonly accountType: "current" | "savings";
}

/**
 * Evidence that the approval threshold was met, decided upstream in the record. The
 * adapter does not decide approval; it refuses a payout without this evidence.
 */
export interface PayoutApproval {
  /** The record event that met the threshold. */
  readonly eventId: EventId;
  /** At least one approver. */
  readonly approvers: readonly Did[];
}

export interface PayoutInput {
  readonly amount: Money;
  /** The event id of the payout decision; the idempotency and reconciliation key. */
  readonly externalReference: EventId;
  readonly beneficiary: PayoutBeneficiary;
  /** At most `BENEFICIARY_REFERENCE_MAX` characters. */
  readonly beneficiaryReference: string;
  readonly approval: PayoutApproval;
}

export interface Payout {
  readonly id: string;
  readonly status: PaymentStatus;
  readonly amount: Money;
  readonly externalReference: EventId;
}

/**
 * Pay suppliers out of the pool (Stitch disbursements). Runs on the OCN Node only.
 * Owning epic: 4. Same idempotency and webhook rules as `PayIn`.
 */
export interface PayOut {
  createPayout(input: PayoutInput): Promise<Result<Payout, PortError<CreateErrorCode>>>;
  getPayout(id: string): Promise<Payout | undefined>;
  ingestWebhook(
    delivery: WebhookDelivery,
  ): Promise<Result<WebhookOutcome<Payout>, PortError<WebhookErrorCode>>>;
}
