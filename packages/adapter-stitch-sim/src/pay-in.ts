// The simulated `PayIn` (Stitch payment requests). Passes `runPayInContract` unchanged.
import {
  BENEFICIARY_REFERENCE_MAX,
  PAYER_REFERENCE_MAX,
  err,
  isEventId,
  isMoney,
  ok,
  type CreateErrorCode,
  type PayIn,
  type PaymentRequest,
  type PaymentRequestInput,
  type PortError,
  type Result,
  type WebhookDelivery,
  type WebhookErrorCode,
  type WebhookOutcome,
} from "@shopong/ports";
import { stitchAmount } from "./amount.js";
import { SIGNATURE_HEADER } from "./signature.js";
import { parseEvent, type TerminalOutcome } from "./stitch-shape.js";
import { requestRef, SIMULATED_MODE, type SimulatedStore, type StoredPayment } from "./store.js";

/** The page a simulated request points at. `.invalid` never resolves, so it cannot be mistaken for Stitch. */
const PAGE_BASE = "https://simulated-stitch.invalid/payment-requests";

/** The largest time a JavaScript Date holds (ECMA-262): anything later cannot be shown or compared. */
const MAX_DATE_MS = 8.64e15;

/** A webhook outcome, plus whether the completion was a late one that was flagged rather than applied. */
export interface SimulatedWebhookOutcome<P> extends WebhookOutcome<P> {
  readonly lateCompletion: boolean;
}

/** What a bank-page action can answer: the webhook codes, plus refusal of an expired request. */
export type BankErrorCode = WebhookErrorCode | "expired";

function view(record: StoredPayment): PaymentRequest {
  return {
    id: record.id,
    url: `${PAGE_BASE}/${record.id}`,
    status: record.status,
    amount: record.amount,
    externalReference: record.externalReference,
    expireAt: record.expireAt ?? 0,
  };
}

export class SimulatedPayIn implements PayIn {
  readonly mode = SIMULATED_MODE;
  readonly #store: SimulatedStore;

  constructor(store: SimulatedStore) {
    this.#store = store;
  }

  /** Expiry is judged at read time on the injected clock; an expired request is stored as expired. */
  #expireIfDue(record: StoredPayment): void {
    if (
      record.status === "pending" &&
      record.expireAt !== undefined &&
      this.#store.now() >= record.expireAt
    ) {
      this.#store.setStatus(record, "expired");
    }
  }

  async createRequest(
    input: PaymentRequestInput,
  ): Promise<Result<PaymentRequest, PortError<CreateErrorCode>>> {
    if (
      !isMoney(input.amount) ||
      input.amount.minor <= 0 ||
      stitchAmount(input.amount.minor) === undefined
    ) {
      return err("invalid_request", "amount must be a positive whole number of minor units");
    }
    if (!isEventId(input.externalReference)) {
      return err("invalid_request", "externalReference must be an event id");
    }
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
    if (
      !Number.isSafeInteger(input.expireAt) ||
      input.expireAt <= this.#store.now() ||
      input.expireAt > MAX_DATE_MS
    ) {
      return err(
        "invalid_request",
        "expireAt must be in the future and within the range of a date",
      );
    }

    // The only await: everything after it is synchronous, so two creates cannot both pass the reference check.
    const fingerprint = await this.#store.fingerprint("pay_in", {
      ...input,
      methods: input.methods ?? ["eft"],
    });
    const existing = this.#store.byReference("pay_in", input.externalReference);
    if (existing !== undefined) {
      if (existing.fingerprint === fingerprint) return ok(view(existing));
      return err("idempotency_conflict", "external reference reused with a different body");
    }
    const record: StoredPayment = {
      id: this.#store.nextId("pay_in"),
      kind: "pay_in",
      status: "pending",
      amount: input.amount,
      externalReference: input.externalReference,
      expireAt: input.expireAt,
      fingerprint,
    };
    this.#store.add(record);
    return ok(view(record));
  }

  async getRequest(id: string): Promise<PaymentRequest | undefined> {
    const record = this.#store.get(id, "pay_in");
    if (record === undefined) return undefined;
    this.#expireIfDue(record);
    return view(record);
  }

  async cancelRequest(id: string): Promise<Result<PaymentRequest, PortError<"unknown_payment">>> {
    const record = this.#store.get(id, "pay_in");
    if (record === undefined) {
      return err("unknown_payment", "simulated Stitch: no payment request for that id");
    }
    this.#expireIfDue(record);
    if (record.status === "pending") this.#store.setStatus(record, "cancelled");
    return ok(view(record));
  }

  /** A verified webhook from the processor. A completion after expiry is flagged, never applied. */
  async ingestWebhook(
    delivery: WebhookDelivery,
  ): Promise<Result<SimulatedWebhookOutcome<PaymentRequest>, PortError<WebhookErrorCode>>> {
    // Only "webhook" origin reaches here with no code beyond WebhookErrorCode.
    return (await this.#ingest(delivery, "webhook")) as Result<
      SimulatedWebhookOutcome<PaymentRequest>,
      PortError<WebhookErrorCode>
    >;
  }

  /**
   * The bank page's buttons (simulated). The page signs a delivery with the Node's key and hands it to the same
   * verified path, but an expired request is refused here, and nothing is flagged as a late completion: a late
   * completion comes only from a signed webhook (review item 4).
   */
  async actAsPayer(
    paymentId: string,
    outcome: TerminalOutcome,
  ): Promise<Result<SimulatedWebhookOutcome<PaymentRequest>, PortError<BankErrorCode>>> {
    const record = this.#store.get(paymentId, "pay_in");
    if (record === undefined)
      return err("unknown_payment", "simulated Stitch: no payment request for that id");
    const delivery = await this.settle(paymentId, outcome);
    return this.#ingest(delivery, "bank");
  }

  async #ingest(
    delivery: WebhookDelivery,
    origin: "webhook" | "bank",
  ): Promise<Result<SimulatedWebhookOutcome<PaymentRequest>, PortError<BankErrorCode>>> {
    // Signature first: nothing in the body is read until it verifies.
    if (!(await this.#store.verify(delivery.headers, delivery.body))) {
      this.#store.log("webhook refused: the signature does not verify");
      return err("invalid_signature", "simulated Stitch: webhook signature does not verify");
    }
    const parsed = parseEvent(delivery.body, "pay_in");
    if (parsed === undefined) {
      return err("malformed", "simulated Stitch: webhook is not a payment request event");
    }
    const record = this.#store.get(parsed.id, "pay_in");
    if (record === undefined) {
      return err("unknown_payment", "simulated Stitch: no payment request for that id");
    }
    if (
      parsed.quantity !== stitchAmount(record.amount.minor) ||
      parsed.currency !== record.amount.currency
    ) {
      return err("malformed", "simulated Stitch: webhook amount does not match the request");
    }

    // Synchronous from here: the status is read and changed in one step.
    this.#expireIfDue(record);
    if (origin === "bank" && record.status === "expired") {
      return err("expired", "This payment request has expired.");
    }
    if (record.status !== "pending") {
      return this.#afterTerminal(record, parsed.outcome);
    }
    this.#store.setStatus(record, parsed.outcome);
    return ok({ payment: view(record), applied: true, lateCompletion: false });
  }

  #afterTerminal(
    record: StoredPayment,
    outcome: TerminalOutcome,
  ): Result<SimulatedWebhookOutcome<PaymentRequest>, PortError<BankErrorCode>> {
    if (
      outcome === "completed" &&
      record.status === "expired" &&
      !this.#store.isFlagged(record.id)
    ) {
      this.#store.flagLate(record, record.amount);
      this.#store.log(
        `late completion flagged, not applied: ${requestRef(record.id)} expired before the completion arrived (simulated)`,
      );
      return ok({ payment: view(record), applied: false, lateCompletion: true });
    }
    return ok({ payment: view(record), applied: false, lateCompletion: false });
  }

  /**
   * The processor's test mode (simulated): the signed delivery Stitch would send for this outcome. It changes
   * nothing by itself; the caller hands it to `ingestWebhook`, which is the only way a status changes.
   */
  async settle(paymentId: string, outcome: TerminalOutcome): Promise<WebhookDelivery> {
    const record = this.#store.get(paymentId, "pay_in");
    if (record === undefined) throw new Error("simulated Stitch: no payment request for that id");
    const body = this.#store.body("pay_in", outcome, record);
    return { headers: { [SIGNATURE_HEADER]: await this.#store.sign(body) }, body };
  }
}
