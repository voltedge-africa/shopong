// The words of a supplier payment on the Orders screen (story 4.7): who must approve, how many have, what a person is
// asked to confirm, and the state of a payment. Each sentence is plain and says "simulated" where money would move.
import { describe, expect, it } from "vite-plus/test";
import {
  approvalPrompt,
  payConfirmationOf,
  payoutCardsOf,
  PAYOUT_SIMULATED_NOTE,
  type PayoutCard,
  type PaymentRecord,
} from "./payouts";

const ME = "did:key:me";
const BOB = "did:key:bob";
const CAROL = "did:key:carol";

const payment = (over: Partial<PaymentRecord> = {}): PaymentRecord => ({
  payout: "p1",
  order: "Spaza restock",
  supplier: "Makro Soweto",
  amountMinor: 50000,
  by: ME,
  approvers: [],
  ...over,
});

describe("the confirmation a person sees before they approve", () => {
  it("names the number needed, the position, the amount, the supplier and the effect, and says it is simulated", () => {
    const lines = approvalPrompt({
      required: 3,
      position: 2,
      amountMinor: 50000,
      supplier: "Makro Soweto",
    });
    expect(lines[0]).toBe("This payment needs 3 approvals. You are approval 2 of 3.");
    expect(lines).toContain("Pay Makro Soweto R500.00 from the pool.");
    expect(lines.join(" ")).toContain("no real money moves");
    expect(lines).toContain(PAYOUT_SIMULATED_NOTE);
  });

  it("says one person when one approval is needed", () => {
    expect(approvalPrompt({ required: 1, position: 1, amountMinor: 100, supplier: "A" })[0]).toBe(
      "This payment needs 1 approval. You are approval 1 of 1.",
    );
  });
});

describe("a payment's state on the screen", () => {
  it("is waiting, with the count, until enough people have approved", () => {
    const [card] = payoutCardsOf({
      payments: [payment({ approvers: [BOB] })],
      required: 2,
      me: CAROL,
      treasurer: true,
      sent: new Map(),
    });
    expect(card).toMatchObject({
      supplier: "Makro Soweto",
      count: 1,
      required: 2,
      title: "Pay Makro Soweto R500.00",
      approvalsText: "1 of 2 approvals so far.",
      statusText: "Waiting for more approvals.",
      canPay: false,
      canApprove: true,
    });
  });

  it("is ready for the treasurer once enough have approved, and says so", () => {
    const [card] = payoutCardsOf({
      payments: [payment({ approvers: [BOB, CAROL] })],
      required: 2,
      me: ME,
      treasurer: true,
      sent: new Map(),
    });
    expect(card).toMatchObject({
      statusText: "Enough approvals. The treasurer can pay the supplier now.",
      canPay: true,
    });
  });

  it("is sent, with the Node's words, once the Node has sent it", () => {
    const [card] = payoutCardsOf({
      payments: [payment({ approvers: [BOB, CAROL] })],
      required: 2,
      me: ME,
      treasurer: true,
      sent: new Map([["p1", "Payment sent to Makro Soweto (simulated). No real money has moved."]]),
    });
    expect(card).toMatchObject({
      statusText: "Payment sent to Makro Soweto (simulated). No real money has moved.",
      canPay: false,
    });
  });

  it("does not offer the treasurer's payment to anyone else, or an approval twice", () => {
    const [card] = payoutCardsOf({
      payments: [payment({ approvers: [BOB, CAROL] })],
      required: 2,
      me: BOB,
      treasurer: false,
      sent: new Map(),
    });
    expect(card).toMatchObject({ canPay: false, canApprove: false, approvedByMe: true });
    expect(card?.approvalsText).toBe("2 of 2 approvals so far.");
  });

  it("shows only the payments for this order", () => {
    const cards = payoutCardsOf(
      {
        payments: [payment(), payment({ payout: "p2", order: "Other" })],
        required: 2,
        me: ME,
        treasurer: true,
        sent: new Map(),
      },
      "Spaza restock",
    );
    expect(cards.map((c) => c.payout)).toEqual(["p1"]);
  });
});

describe("the pay confirmation and the approval notices [S-4.7 fixes 4, 7]", () => {
  const card = (over: Partial<PayoutCard> = {}): PayoutCard => ({
    payout: "p1",
    supplier: "Makro Soweto",
    amountMinor: 50000,
    count: 2,
    required: 2,
    title: "Pay Makro Soweto R500.00",
    approvalsText: "2 of 2 approvals so far.",
    statusText: "Enough approvals. The treasurer can pay the supplier now.",
    canApprove: false,
    approvedByMe: true,
    canPay: true,
    ...over,
  });

  it("names the amount, the supplier, the approvals in the record and that it is simulated, before any payment is sent", () => {
    expect(payConfirmationOf(card())).toEqual([
      "Pay Makro Soweto R500.00 from the pool.",
      "2 of 2 approvals are in the record.",
      PAYOUT_SIMULATED_NOTE,
    ]);
  });

  it("shows the record's reason an approval did not count, and leaves the count as the record holds it", () => {
    const [mine] = payoutCardsOf(
      {
        payments: [payment({ approvers: [BOB] })],
        required: 2,
        me: CAROL,
        treasurer: false,
        sent: new Map(),
        approvalNotices: new Map([["p1", "That is above your limit of R1000."]]),
      },
      "Spaza restock",
    );
    expect(mine?.notice).toBe("That is above your limit of R1000.");
    expect(mine?.approvalsText).toBe("1 of 2 approvals so far.");
  });
});
