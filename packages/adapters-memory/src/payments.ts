import {
  BENEFICIARY_REFERENCE_MAX,
  PAYER_REFERENCE_MAX,
  TERMINAL_PAYMENT_STATUSES,
  err,
  isDid,
  isEventId,
  isMoney,
  ok,
  type Clock,
  type CreateErrorCode,
  type EventId,
  type IdGenerator,
  type PayIn,
  type PayOut,
  type PaymentRequest,
  type PaymentRequestInput,
  type PaymentStatus,
  type Payout,
  type PayoutInput,
  type PortError,
  type Result,
  type WebhookDelivery,
  type WebhookErrorCode,
  type WebhookOutcome,
} from "@shopong/ports";
import { createCounterIds, createManualClock, fakeDigest, stableStringify } from "./support.js";

const SIGNATURE_HEADER = "x-memory-signature";

export interface MemoryPaymentsOptions {
  clock?: Clock;
  ids?: IdGenerator;
  /** Shared secret for the simulated webhook signature. */
  webhookSecret?: string;
}

/** A terminal outcome a simulated processor can report. */
export type SimulatedOutcome = Exclude<PaymentStatus, "pending">;

interface Tracked<P> {
  payment: P;
  body: string;
}

/**
 * Shared machinery: idempotent creation by external reference, and signed webhooks that
 * move a payment to a terminal state exactly once.
 */
class PaymentBook<P extends { id: string; status: PaymentStatus; externalReference: EventId }> {
  readonly byId = new Map<string, Tracked<P>>();
  readonly #byReference = new Map<EventId, string>();
  readonly #secret: string;
  readonly #ids: IdGenerator;

  constructor(secret: string, ids: IdGenerator) {
    this.#secret = secret;
    this.#ids = ids;
  }

  create(
    reference: EventId,
    body: unknown,
    build: (id: string) => P,
  ): Result<P, PortError<CreateErrorCode>> {
    const serialised = stableStringify(body);
    const existing = this.#byReference.get(reference);
    if (existing !== undefined) {
      const tracked = this.byId.get(existing);
      if (tracked !== undefined && tracked.body === serialised) return ok(tracked.payment);
      return err("idempotency_conflict", "external reference reused with a different body");
    }
    const payment = build(this.#ids.next("pay"));
    this.byId.set(payment.id, { payment, body: serialised });
    this.#byReference.set(reference, payment.id);
    return ok(payment);
  }

  setStatus(id: string, status: PaymentStatus): void {
    const tracked = this.byId.get(id);
    if (tracked !== undefined) tracked.payment = { ...tracked.payment, status };
  }

  simulate(id: string, outcome: SimulatedOutcome): WebhookDelivery {
    const body = JSON.stringify({
      type: "payment",
      deliveryId: this.#ids.next("whk"),
      paymentId: id,
      status: outcome,
    });
    return { headers: { [SIGNATURE_HEADER]: fakeDigest(`${this.#secret}|${body}`) }, body };
  }

  ingest(delivery: WebhookDelivery): Result<WebhookOutcome<P>, PortError<WebhookErrorCode>> {
    const signature = delivery.headers[SIGNATURE_HEADER];
    if (signature !== fakeDigest(`${this.#secret}|${delivery.body}`)) {
      return err("invalid_signature", "webhook signature does not verify");
    }
    let parsed: { paymentId?: unknown; status?: unknown };
    try {
      parsed = JSON.parse(delivery.body) as typeof parsed;
    } catch {
      return err("malformed", "webhook body is not JSON");
    }
    const { paymentId, status } = parsed;
    if (
      typeof paymentId !== "string" ||
      !TERMINAL_PAYMENT_STATUSES.includes(status as PaymentStatus)
    ) {
      return err("malformed", "webhook body lacks paymentId or a terminal status");
    }
    const tracked = this.byId.get(paymentId);
    if (tracked === undefined) return err("unknown_payment", `unknown payment ${paymentId}`);
    if (tracked.payment.status !== "pending")
      return ok({ payment: tracked.payment, applied: false });
    this.setStatus(paymentId, status as PaymentStatus);
    return ok({ payment: this.byId.get(paymentId)?.payment ?? tracked.payment, applied: true });
  }
}

function positiveMoney(value: unknown): boolean {
  return isMoney(value) && value.minor > 0;
}

/** In-memory `PayIn` modelled on Stitch payment requests. */
export class MemoryPayIn implements PayIn {
  readonly #clock: Clock;
  readonly #book: PaymentBook<PaymentRequest>;

  constructor(options: MemoryPaymentsOptions = {}) {
    this.#clock = options.clock ?? createManualClock();
    this.#book = new PaymentBook(
      options.webhookSecret ?? "memory-webhook-secret",
      options.ids ?? createCounterIds(),
    );
  }

  async createRequest(
    input: PaymentRequestInput,
  ): Promise<Result<PaymentRequest, PortError<CreateErrorCode>>> {
    if (!positiveMoney(input.amount))
      return err("invalid_request", "amount must be positive integer minor units");
    if (!isEventId(input.externalReference))
      return err("invalid_request", "externalReference must be an event id");
    if (input.payerReference.length === 0 || input.payerReference.length > PAYER_REFERENCE_MAX) {
      return err(
        "invalid_request",
        `payerReference must be 1..${String(PAYER_REFERENCE_MAX)} characters`,
      );
    }
    if (
      input.beneficiaryReference.length === 0 ||
      input.beneficiaryReference.length > BENEFICIARY_REFERENCE_MAX
    ) {
      return err(
        "invalid_request",
        `beneficiaryReference must be 1..${String(BENEFICIARY_REFERENCE_MAX)} characters`,
      );
    }
    if (!Number.isSafeInteger(input.expireAt) || input.expireAt <= this.#clock.now()) {
      return err("invalid_request", "expireAt must be in the future");
    }
    return this.#book.create(
      input.externalReference,
      { ...input, methods: input.methods ?? ["eft"] },
      (id) => ({
        id,
        url: `https://pay.memory.invalid/requests/${id}`,
        status: "pending",
        amount: input.amount,
        externalReference: input.externalReference,
        expireAt: input.expireAt,
      }),
    );
  }

  async getRequest(id: string): Promise<PaymentRequest | undefined> {
    const tracked = this.#book.byId.get(id);
    if (tracked === undefined) return undefined;
    if (tracked.payment.status === "pending" && this.#clock.now() >= tracked.payment.expireAt) {
      this.#book.setStatus(id, "expired");
    }
    return this.#book.byId.get(id)?.payment;
  }

  async cancelRequest(id: string): Promise<Result<PaymentRequest, PortError<"unknown_payment">>> {
    const current = await this.getRequest(id);
    if (current === undefined) return err("unknown_payment", `unknown payment ${id}`);
    if (current.status === "pending") this.#book.setStatus(id, "cancelled");
    return ok(this.#book.byId.get(id)?.payment ?? current);
  }

  async ingestWebhook(
    delivery: WebhookDelivery,
  ): Promise<Result<WebhookOutcome<PaymentRequest>, PortError<WebhookErrorCode>>> {
    return this.#book.ingest(delivery);
  }

  /** Test control: the signed webhook the processor would send for this outcome. Changes nothing by itself. */
  simulateWebhook(id: string, outcome: SimulatedOutcome): WebhookDelivery {
    return this.#book.simulate(id, outcome);
  }
}

/** In-memory `PayOut` modelled on Stitch disbursements. */
export class MemoryPayOut implements PayOut {
  readonly #book: PaymentBook<Payout>;

  constructor(options: MemoryPaymentsOptions = {}) {
    this.#book = new PaymentBook(
      options.webhookSecret ?? "memory-webhook-secret",
      options.ids ?? createCounterIds(),
    );
  }

  async createPayout(input: PayoutInput): Promise<Result<Payout, PortError<CreateErrorCode>>> {
    if (!positiveMoney(input.amount))
      return err("invalid_request", "amount must be positive integer minor units");
    if (!isEventId(input.externalReference))
      return err("invalid_request", "externalReference must be an event id");
    if (
      !isEventId(input.approval.eventId) ||
      input.approval.approvers.length === 0 ||
      !input.approval.approvers.every(isDid)
    ) {
      return err(
        "invalid_request",
        "approval evidence needs the approving event id and at least one approver DID",
      );
    }
    const { name, bankId, accountNumber, accountType } = input.beneficiary;
    if (name.trim() === "" || bankId.trim() === "" || !/^\d{6,16}$/.test(accountNumber)) {
      return err(
        "invalid_request",
        "beneficiary needs a name, bank and a 6-16 digit account number",
      );
    }
    if (accountType !== "current" && accountType !== "savings")
      return err("invalid_request", "bad account type");
    if (
      input.beneficiaryReference.length === 0 ||
      input.beneficiaryReference.length > BENEFICIARY_REFERENCE_MAX
    ) {
      return err(
        "invalid_request",
        `beneficiaryReference must be 1..${String(BENEFICIARY_REFERENCE_MAX)} characters`,
      );
    }
    return this.#book.create(input.externalReference, input, (id) => ({
      id,
      status: "pending",
      amount: input.amount,
      externalReference: input.externalReference,
    }));
  }

  async getPayout(id: string): Promise<Payout | undefined> {
    return this.#book.byId.get(id)?.payment;
  }

  async ingestWebhook(
    delivery: WebhookDelivery,
  ): Promise<Result<WebhookOutcome<Payout>, PortError<WebhookErrorCode>>> {
    return this.#book.ingest(delivery);
  }

  /** Test control: the signed webhook the processor would send for this outcome. Changes nothing by itself. */
  simulateWebhook(id: string, outcome: SimulatedOutcome): WebhookDelivery {
    return this.#book.simulate(id, outcome);
  }
}
