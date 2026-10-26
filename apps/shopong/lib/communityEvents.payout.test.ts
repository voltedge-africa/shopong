// The phone's payout events (story 4.7): the founding approvals setting, the treasurer's payment and each approval.
import { describe, expect, it } from "vite-plus/test";
import { approvalBytes, FOUNDER_INVITATION } from "@shopong/community";
import { parseEvent } from "@shopong/events";
import type { Did } from "@shopong/ports";
import { approvalEvent, founderEvent, payoutEvent } from "./communityEvents";

const BANK = "12".repeat(64);
const ME = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK" as Did;
const COMMUNITY = "ab".repeat(32);
const base = {
  community: COMMUNITY,
  me: ME,
  now: 1_793_000_000_000,
  randomBytes: (n: number) => new Uint8Array(n).fill(7),
};

describe("the founding event carries the approvals setting", () => {
  it("writes the chosen number", () => {
    expect(founderEvent({ ...base, approvals: 4 }).payload).toEqual({
      invitation: FOUNDER_INVITATION,
      approvals: 4,
    });
  });

  it("writes nothing when no number is given, so the record uses two", () => {
    expect(founderEvent(base).payload).toEqual({ invitation: FOUNDER_INVITATION });
  });
});

describe("the treasurer's payment event", () => {
  it("names the order, supplier, amount in cents and the recommendation", () => {
    const event = payoutEvent({
      ...base,
      order: "Spaza restock",
      supplier: "Makro Soweto",
      amountMinor: 50000,
      recommendation: "clear",
      bank: BANK,
    });
    expect(event.type).toBe("payment.payout");
    expect(event.payload).toEqual({
      order: "Spaza restock",
      supplier: "Makro Soweto",
      amount: { currency: "ZAR", minor: 50000 },
      recommendation: "clear",
      bank: BANK,
    });
    expect(parseEvent(event).ok).toBe(true);
  });
});

describe("an approval event", () => {
  it("carries the payment id and the signature over the approver's own bytes", () => {
    const payout = "cd".repeat(64);
    const terms = { order: "Spaza restock", supplier: "Makro Soweto", amountMinor: 50000 };
    const event = approvalEvent({
      ...base,
      payout,
      ...terms,
      bank: BANK,
      signature: "sig",
    });
    expect(event.type).toBe("payment.approved");
    expect(event.payload).toEqual({
      payout,
      order: terms.order,
      supplier: terms.supplier,
      amount: { currency: "ZAR", minor: 50000 },
      bank: BANK,
      signature: "sig",
    });
    expect(parseEvent(event).ok).toBe(true);
    // The bytes the phone signs are the ones the record checks (domain-tagged, this community, this payment).
    expect(
      new TextDecoder().decode(approvalBytes(COMMUNITY, payout, ME, { ...terms, bank: BANK })),
    ).toContain("ocn-approval/v1");
  });
});
