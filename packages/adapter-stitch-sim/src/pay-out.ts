// The simulated `PayOut` (Stitch disbursements, simulated shape). Passes `runPayOutContract` unchanged.
import {
  BENEFICIARY_REFERENCE_MAX,
  err,
  isDid,
  isEventId,
  isMoney,
  ok,
  type CreateErrorCode,
  type PayOut,
  type Payout,
  type PayoutInput,
  type PortError,
  type Result,
  type WebhookDelivery,
  type WebhookErrorCode,
  type WebhookOutcome,
} from "@shopong/ports";
import { stitchAmount } from "./amount.js";
import { SIGNATURE_HEADER } from "./signature.js";
import { parseEvent, type TerminalOutcome } from "./stitch-shape.js";
import { SIMULATED_MODE, type StoredPayment, type SimulatedStore } from "./store.js";

function view(record: StoredPayment): Payout {
  return {
    id: record.id,
    status: record.status,
    amount: record.amount,
    externalReference: record.externalReference,
  };
}

export class SimulatedPayOut implements PayOut {
  readonly mode = SIMULATED_MODE;
  readonly #store: SimulatedStore;

  constructor(store: SimulatedStore) {
    this.#store = store;
  }

  async createPayout(input: PayoutInput): Promise<Result<Payout, PortError<CreateErrorCode>>> {
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
    if (name.trim() === "" || bankId.trim() === "" || !/^\d{6,16}$/u.test(accountNumber)) {
      return err(
        "invalid_request",
        "beneficiary needs a name, bank and a 6-16 digit account number",
      );
    }
    if (accountType !== "current" && accountType !== "savings") {
      return err("invalid_request", "bad account type");
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

    // The only await; the rest is synchronous. The fingerprint covers the whole request, bank details included,
    // but is keyed, so the account number is not recoverable from what is stored.
    const fingerprint = await this.#store.fingerprint("pay_out", input);
    const existing = this.#store.byReference("pay_out", input.externalReference);
    if (existing !== undefined) {
      if (existing.fingerprint === fingerprint) return ok(view(existing));
      return err("idempotency_conflict", "external reference reused with a different body");
    }
    const record: StoredPayment = {
      id: this.#store.nextId("pay_out"),
      kind: "pay_out",
      status: "pending",
      amount: input.amount,
      externalReference: input.externalReference,
      fingerprint,
    };
    this.#store.add(record);
    return ok(view(record));
  }

  async getPayout(id: string): Promise<Payout | undefined> {
    const record = this.#store.get(id, "pay_out");
    return record === undefined ? undefined : view(record);
  }

  async ingestWebhook(
    delivery: WebhookDelivery,
  ): Promise<Result<WebhookOutcome<Payout>, PortError<WebhookErrorCode>>> {
    if (!(await this.#store.verify(delivery.headers, delivery.body))) {
      this.#store.log("webhook refused: the signature does not verify");
      return err("invalid_signature", "simulated Stitch: webhook signature does not verify");
    }
    const parsed = parseEvent(delivery.body, "pay_out");
    if (parsed === undefined) {
      return err("malformed", "simulated Stitch: webhook is not a disbursement event");
    }
    const record = this.#store.get(parsed.id, "pay_out");
    if (record === undefined) {
      return err("unknown_payment", `simulated Stitch: no payout ${parsed.id}`);
    }
    if (
      parsed.quantity !== stitchAmount(record.amount.minor) ||
      parsed.currency !== record.amount.currency
    ) {
      return err("malformed", "simulated Stitch: webhook amount does not match the payout");
    }
    if (record.status !== "pending") return ok({ payment: view(record), applied: false });
    this.#store.setStatus(record, parsed.outcome);
    return ok({ payment: view(record), applied: true });
  }

  /** The processor's test mode for a payout (simulated). Changes nothing by itself. */
  async settle(payoutId: string, outcome: TerminalOutcome): Promise<WebhookDelivery> {
    const record = this.#store.get(payoutId, "pay_out");
    if (record === undefined) throw new Error(`simulated Stitch: no payout ${payoutId}`);
    const body = this.#store.body("pay_out", outcome, record);
    return { headers: { [SIGNATURE_HEADER]: await this.#store.sign(body) }, body };
  }
}
