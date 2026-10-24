import { expect } from "vite-plus/test";
import {
  money,
  type Did,
  type PayIn,
  type PayOut,
  type PaymentRequestInput,
  type PaymentStatus,
  type PayoutInput,
  type WebhookDelivery,
} from "@shopong/ports";
import {
  expectErr,
  expectOk,
  randomEventId,
  registerContract,
  type ContractCase,
  type ContractOptions,
  type Factory,
} from "./support.js";

/** A terminal outcome the processor's test mode can produce. */
export type SettleOutcome = Exclude<PaymentStatus, "pending">;

export interface PayInHarness {
  readonly payIn: PayIn;
  /** Drive the processor's test mode to this outcome and return the signed webhook it sent. */
  readonly settle: (paymentId: string, outcome: SettleOutcome) => Promise<WebhookDelivery>;
}

export interface PayOutHarness {
  readonly payOut: PayOut;
  readonly settle: (payoutId: string, outcome: SettleOutcome) => Promise<WebhookDelivery>;
}

const DAY = 86_400_000;

function pledge(overrides: Partial<PaymentRequestInput> = {}): PaymentRequestInput {
  return {
    amount: money("ZAR", 150_00),
    externalReference: randomEventId(),
    payerReference: "STOKVEL-JAN",
    beneficiaryReference: "OCN POOL",
    // Relative to the wall clock: this is the processor's clock, not apply's log time.
    expireAt: Date.now() + DAY,
    ...overrides,
  };
}

/** Change the body without breaking it as JSON, so only the signature check can catch it. */
function tamper(delivery: WebhookDelivery): WebhookDelivery {
  return { headers: delivery.headers, body: `${delivery.body} ` };
}

export const payInContract: readonly ContractCase<PayInHarness>[] = [
  {
    name: "creates a pending request carrying the external reference",
    run: async ({ payIn }) => {
      const input = pledge();
      const request = expectOk(await payIn.createRequest(input));
      expect(request).toMatchObject({
        status: "pending",
        amount: input.amount,
        externalReference: input.externalReference,
        expireAt: input.expireAt,
      });
      expect(request.url).toMatch(/^https:\/\//);
      expect(await payIn.getRequest(request.id)).toMatchObject({
        id: request.id,
        status: "pending",
      });
    },
  },
  {
    name: "the same external reference and body returns the same request; a different body conflicts",
    run: async ({ payIn }) => {
      const input = pledge();
      const first = expectOk(await payIn.createRequest(input));
      const again = expectOk(await payIn.createRequest({ ...input }));
      expect(again.id).toBe(first.id);
      expectErr(
        await payIn.createRequest({ ...input, amount: money("ZAR", 200_00) }),
        "idempotency_conflict",
      );
    },
  },
  {
    name: "rejects invalid requests",
    run: async ({ payIn }) => {
      expectErr(
        await payIn.createRequest(pledge({ payerReference: "X".repeat(13) })),
        "invalid_request",
      );
      expectErr(
        await payIn.createRequest(pledge({ beneficiaryReference: "X".repeat(21) })),
        "invalid_request",
      );
      expectErr(await payIn.createRequest(pledge({ amount: money("ZAR", 0) })), "invalid_request");
      expectErr(
        await payIn.createRequest(pledge({ amount: { currency: "ZAR", minor: 10.5 } })),
        "invalid_request",
      );
      expectErr(
        await payIn.createRequest(
          pledge({
            externalReference: "not-an-event-id" as PaymentRequestInput["externalReference"],
          }),
        ),
        "invalid_request",
      );
    },
  },
  {
    name: "an unknown payment id is undefined",
    run: async ({ payIn }) => {
      expect(await payIn.getRequest("no-such-payment")).toBeUndefined();
      expectErr(await payIn.cancelRequest("no-such-payment"), "unknown_payment");
    },
  },
  {
    name: "a verified completion webhook completes the request exactly once",
    run: async ({ payIn, settle }) => {
      const request = expectOk(await payIn.createRequest(pledge()));
      const delivery = await settle(request.id, "completed");
      const first = expectOk(await payIn.ingestWebhook(delivery));
      expect(first.applied).toBe(true);
      expect(first.payment).toMatchObject({ id: request.id, status: "completed" });
      const replay = expectOk(await payIn.ingestWebhook(delivery));
      expect(replay.applied).toBe(false);
      expect(replay.payment.status).toBe("completed");
      expect((await payIn.getRequest(request.id))?.status).toBe("completed");
    },
  },
  {
    name: "each terminal outcome is reported as its status",
    run: async ({ payIn, settle }) => {
      for (const outcome of ["cancelled", "expired", "failed"] as const) {
        const request = expectOk(await payIn.createRequest(pledge()));
        expectOk(await payIn.ingestWebhook(await settle(request.id, outcome)));
        expect((await payIn.getRequest(request.id))?.status).toBe(outcome);
      }
    },
  },
  {
    name: "a webhook with a bad or missing signature is refused and changes nothing",
    run: async ({ payIn, settle }) => {
      const request = expectOk(await payIn.createRequest(pledge()));
      const delivery = await settle(request.id, "completed");
      expectErr(await payIn.ingestWebhook(tamper(delivery)), "invalid_signature");
      expectErr(
        await payIn.ingestWebhook({ headers: {}, body: delivery.body }),
        "invalid_signature",
      );
      expect((await payIn.getRequest(request.id))?.status).toBe("pending");
    },
  },
  {
    name: "a pending request can be cancelled",
    run: async ({ payIn }) => {
      const request = expectOk(await payIn.createRequest(pledge()));
      expect(expectOk(await payIn.cancelRequest(request.id)).status).toBe("cancelled");
      expect((await payIn.getRequest(request.id))?.status).toBe("cancelled");
    },
  },
];

const approver: Did = "did:key:z6MkTreasurer";

function payout(overrides: Partial<PayoutInput> = {}): PayoutInput {
  return {
    amount: money("ZAR", 4500_00),
    externalReference: randomEventId(),
    beneficiary: {
      name: "Bulk Foods Wholesale",
      bankId: "fnb",
      accountNumber: "62000000001",
      accountType: "current",
    },
    beneficiaryReference: "ORDER 42",
    approval: { eventId: randomEventId(), approvers: [approver] },
    ...overrides,
  };
}

export const payOutContract: readonly ContractCase<PayOutHarness>[] = [
  {
    name: "creates a pending payout carrying the external reference",
    run: async ({ payOut }) => {
      const input = payout();
      const created = expectOk(await payOut.createPayout(input));
      expect(created).toMatchObject({
        status: "pending",
        amount: input.amount,
        externalReference: input.externalReference,
      });
      expect(await payOut.getPayout(created.id)).toMatchObject({
        id: created.id,
        status: "pending",
      });
    },
  },
  {
    name: "the same external reference and body returns the same payout; a different body conflicts",
    run: async ({ payOut }) => {
      const input = payout();
      const first = expectOk(await payOut.createPayout(input));
      expect(expectOk(await payOut.createPayout({ ...input })).id).toBe(first.id);
      expectErr(
        await payOut.createPayout({ ...input, amount: money("ZAR", 1) }),
        "idempotency_conflict",
      );
    },
  },
  {
    name: "refuses a payout without approval evidence or with bad details",
    run: async ({ payOut }) => {
      const base = payout();
      expectErr(
        await payOut.createPayout(
          payout({ approval: { eventId: randomEventId(), approvers: [] } }),
        ),
        "invalid_request",
      );
      expectErr(
        await payOut.createPayout(
          payout({ beneficiary: { ...base.beneficiary, accountNumber: "" } }),
        ),
        "invalid_request",
      );
      expectErr(await payOut.createPayout(payout({ amount: money("ZAR", 0) })), "invalid_request");
      expectErr(
        await payOut.createPayout(payout({ beneficiaryReference: "X".repeat(21) })),
        "invalid_request",
      );
    },
  },
  {
    name: "an unknown payout id is undefined",
    run: async ({ payOut }) => {
      expect(await payOut.getPayout("no-such-payout")).toBeUndefined();
    },
  },
  {
    name: "a verified webhook settles the payout exactly once",
    run: async ({ payOut, settle }) => {
      const created = expectOk(await payOut.createPayout(payout()));
      const delivery = await settle(created.id, "completed");
      expect(expectOk(await payOut.ingestWebhook(delivery)).applied).toBe(true);
      const replay = expectOk(await payOut.ingestWebhook(delivery));
      expect(replay.applied).toBe(false);
      expect((await payOut.getPayout(created.id))?.status).toBe("completed");
    },
  },
  {
    name: "a webhook with a bad signature is refused and changes nothing",
    run: async ({ payOut, settle }) => {
      const created = expectOk(await payOut.createPayout(payout()));
      expectErr(
        await payOut.ingestWebhook(tamper(await settle(created.id, "failed"))),
        "invalid_signature",
      );
      expect((await payOut.getPayout(created.id))?.status).toBe("pending");
    },
  },
];

/** Register the `PayIn` contract against an adapter. */
export function runPayInContract(factory: Factory<PayInHarness>, options?: ContractOptions): void {
  registerContract("PayIn contract", payInContract, factory, options);
}

/** Register the `PayOut` contract against an adapter. */
export function runPayOutContract(
  factory: Factory<PayOutHarness>,
  options?: ContractOptions,
): void {
  registerContract("PayOut contract", payOutContract, factory, options);
}
