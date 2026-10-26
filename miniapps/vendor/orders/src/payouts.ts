// The words of a supplier payment on the Orders screen (story 4.7). The Node decides every figure and every refusal;
// this only lays out what the Node's record and answers say, in plain words. Payments are simulated: each line that
// would otherwise sound like money moving says so.
import { randText } from "./form";

export const PAYOUT_SIMULATED_NOTE =
  "Payments are simulated: no real money moves and no bank is contacted.";

/** Said beside every "Supplier paid": the bank is the simulation. */
export const SUPPLIER_PAID_NOTE = "Test payment (simulated): no real money moved.";

/** A payment the treasurer recorded for this order, as the record holds it. */
export interface PaymentRecord {
  /** The record event id of the treasurer's payment: the key of the payment everywhere (AGENTS rule 5). */
  readonly payout: string;
  readonly order: string;
  readonly supplier: string;
  /** Whole rand cents. */
  readonly amountMinor: number;
  /** The DID of the person who recorded the payment (the treasurer). */
  readonly by: string;
  /** The DIDs whose approval the record holds for this payment. */
  readonly approvers: readonly string[];
}

export interface PayoutCardInput {
  readonly payments: readonly PaymentRecord[];
  /** The number of approvals the community's setting asks for. */
  readonly required: number;
  /** The DID of the person looking at the screen. */
  readonly me: string;
  /** Whether this person is the treasurer, so may pay. */
  readonly treasurer: boolean;
  /** The Node's plain sentence for each payment it has sent, by payment id. */
  readonly sent: ReadonlyMap<string, string>;
  /** The payments the record shows as paid out of the pool, by payment id, with the amount paid in cents (story 8.5). */
  readonly paid?: ReadonlyMap<string, number>;
  /** The record's plain reason for an approval this phone sent that did not count, by payment id. */
  readonly approvalNotices?: ReadonlyMap<string, string>;
}

export interface PayoutCard {
  /** The record's plain reason this person's approval did not count (the count does not move). */
  readonly notice?: string;
  readonly payout: string;
  readonly supplier: string;
  readonly amountMinor: number;
  /** Approvals the record holds, and the number the community needs. */
  readonly count: number;
  readonly required: number;
  readonly title: string;
  readonly approvalsText: string;
  readonly statusText: string;
  readonly canApprove: boolean;
  readonly approvedByMe: boolean;
  readonly canPay: boolean;
  /** True when the record shows the supplier as paid (story 8.5). */
  readonly paid: boolean;
  /** Set once the Node has sent the payment: the payment is then never offered again. */
  readonly sentText?: string;
}

const COUNT = ["zero", "one", "two", "three", "four", "five"] as const;
const word = (n: number) => COUNT[n] ?? String(n);

/** The sentences a person reads before they approve: the count, their position, the amount, supplier and effect. */
export function approvalPrompt(input: {
  readonly required: number;
  readonly position: number;
  readonly amountMinor: number;
  readonly supplier: string;
}): readonly string[] {
  const plural = input.required === 1 ? "approval" : "approvals";
  return [
    `This payment needs ${input.required} ${plural}. You are approval ${input.position} of ${input.required}.`,
    `Pay ${input.supplier} ${randText(input.amountMinor)} from the pool.`,
    "Your approval is signed on this phone and checked by the OCN Node against your limit.",
    PAYOUT_SIMULATED_NOTE,
  ];
}

/** The payments recorded for one order, each with its words for this person. */
export function payoutCardsOf(input: PayoutCardInput, order?: string): PayoutCard[] {
  return input.payments
    .filter((payment) => order === undefined || payment.order === order)
    .map((payment) => {
      const count = new Set(payment.approvers).size;
      const approvedByMe = payment.approvers.includes(input.me);
      const enough = count >= input.required;
      const paidMinor = input.paid?.get(payment.payout);
      const paid = paidMinor !== undefined;
      // The record's word comes first: a person who opens the app later, or on another phone, sees the same thing.
      const sentText = paid
        ? `Supplier paid: ${payment.supplier} was paid ${randText(paidMinor)}. ${SUPPLIER_PAID_NOTE}`
        : input.sent.get(payment.payout);
      const statusText =
        sentText ??
        (enough
          ? "Enough approvals. The treasurer can pay the supplier now."
          : "Waiting for more approvals.");
      const notice = input.approvalNotices?.get(payment.payout);
      return {
        ...(notice === undefined ? {} : { notice }),
        payout: payment.payout,
        supplier: payment.supplier,
        amountMinor: payment.amountMinor,
        count,
        required: input.required,
        title: `Pay ${payment.supplier} ${randText(payment.amountMinor)}`,
        approvalsText: `${count} of ${input.required} ${input.required === 1 ? "approval" : "approvals"} so far.`,
        statusText,
        canApprove: !approvedByMe && sentText === undefined,
        approvedByMe,
        canPay: input.treasurer && enough && sentText === undefined,
        paid,
        ...(sentText === undefined ? {} : { sentText }),
      };
    });
}

/** Spelled out for the approvals sentence in other places (for example, "two"). */
export const approvalsWord = (n: number) => word(n);

/**
 * What the pay confirmation names before the Node is asked to pay (AGENTS rule 8): the amount, the supplier, the approvals
 * the record holds, and that nothing real moves. The person confirms or cancels; nothing is sent until they confirm.
 */
export function payConfirmationOf(card: PayoutCard): readonly string[] {
  return [
    `Pay ${card.supplier} ${randText(card.amountMinor)} from the pool.`,
    `${card.count} of ${card.required} ${card.required === 1 ? "approval is" : "approvals are"} in the record.`,
    PAYOUT_SIMULATED_NOTE,
  ];
}
