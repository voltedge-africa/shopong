// The Stitch-shaped webhook bodies the simulation sends. The payment request body follows the documented
// `PaymentInitiationRequestCompleted` shape (docs/sandbox-setup.md, technology-register). The simulated mark is
// NOT in the body: it lives in the adapter's mode, its log lines and the signing key. Types the docs did not name
// are marked `Simulated` so nothing reads them as Stitch's.
import type { EventId, Money, PaymentStatus } from "@shopong/ports";
import { stitchAmount } from "./amount.js";

export type TerminalOutcome = Exclude<PaymentStatus, "pending">;
export type Kind = "pay_in" | "pay_out";

/** Payment requests. Completed, Cancelled and Expired are documented; Failed is not, so it is simulation-only. */
const PAY_IN_TYPES: Readonly<Record<TerminalOutcome, string>> = {
  completed: "PaymentInitiationRequestCompleted",
  cancelled: "PaymentInitiationRequestCancelled",
  expired: "PaymentInitiationRequestExpired",
  failed: "SimulatedPaymentInitiationRequestFailed",
};

/** Disbursements: no event shape is documented for them yet, so every type is named as simulated. */
const PAY_OUT_TYPES: Readonly<Record<TerminalOutcome, string>> = {
  completed: "SimulatedDisbursementCompleted",
  cancelled: "SimulatedDisbursementCancelled",
  expired: "SimulatedDisbursementExpired",
  failed: "SimulatedDisbursementFailed",
};

const TYPES: Readonly<Record<Kind, Readonly<Record<TerminalOutcome, string>>>> = {
  pay_in: PAY_IN_TYPES,
  pay_out: PAY_OUT_TYPES,
};

function amountOf(money: Money): { quantity: string; currency: string } {
  const quantity = stitchAmount(money.minor);
  if (quantity === undefined)
    throw new TypeError("simulated Stitch: amount must be whole minor units");
  return { quantity, currency: money.currency };
}

/** The body of a payment request event, as Stitch would send it (the documented shape for pay-ins). */
export function payInBody(
  outcome: TerminalOutcome,
  id: string,
  externalReference: EventId,
  amount: Money,
): string {
  return JSON.stringify({
    type: PAY_IN_TYPES[outcome],
    data: {
      paymentInitiationRequest: { id, externalReference, amount: amountOf(amount) },
    },
  });
}

/** The body of a disbursement event (simulated shape). */
export function payOutBody(
  outcome: TerminalOutcome,
  id: string,
  externalReference: EventId,
  amount: Money,
): string {
  return JSON.stringify({
    type: PAY_OUT_TYPES[outcome],
    data: { disbursement: { id, externalReference, amount: amountOf(amount) } },
  });
}

export interface ParsedEvent {
  readonly outcome: TerminalOutcome;
  readonly id: string;
  readonly quantity: string;
  readonly currency: string;
}

const OUTCOMES: readonly TerminalOutcome[] = ["completed", "cancelled", "expired", "failed"];

/**
 * Reads a delivery body of the given kind. Undefined when the text is not JSON, or is not an event of that kind
 * (a pay-out body sent to the pay-in side, for example), so the caller can refuse it as malformed.
 */
export function parseEvent(text: string, kind: Kind): ParsedEvent | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const { type, data } = parsed as { type?: unknown; data?: unknown };
  if (typeof type !== "string" || typeof data !== "object" || data === null) return undefined;
  const outcome = OUTCOMES.find((o) => TYPES[kind][o] === type);
  if (outcome === undefined) return undefined;
  const object = kind === "pay_in" ? "paymentInitiationRequest" : "disbursement";
  const inner = (data as Record<string, unknown>)[object];
  if (typeof inner !== "object" || inner === null) return undefined;
  const { id, amount } = inner as { id?: unknown; amount?: unknown };
  if (typeof id !== "string" || typeof amount !== "object" || amount === null) return undefined;
  const { quantity, currency } = amount as { quantity?: unknown; currency?: unknown };
  if (typeof quantity !== "string" || typeof currency !== "string") return undefined;
  return { outcome, id, quantity, currency };
}
