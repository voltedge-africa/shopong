import { describe, expect, it } from "vite-plus/test";
import { parseEvent } from "../src/index.js";

// Story 4.7: the two record types a supplier payment writes. Rows are the security and money rules.
const base = {
  v: 1,
  space: "ab".repeat(32),
  actor: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
  proof: [],
  claimedAt: 1793001600000,
  nonce: "00".repeat(16),
};
const payout = "cd".repeat(64);
const signature = "ef".repeat(32);
const amount = { currency: "ZAR", minor: 50000 };
const bank = "12".repeat(64);

describe("payment.payout payload", () => {
  const good = {
    bank: bank,
    order: "Spaza restock",
    supplier: "Makro Soweto",
    amount,
    recommendation: "clear",
  };

  it("accepts the strict shape", () => {
    expect(parseEvent({ ...base, type: "payment.payout", payload: good }).ok).toBe(true);
  });

  it.each([
    ["without an order", { ...good, order: undefined }],
    ["without a bank commitment", { ...good, bank: undefined }],
    ["with a bank commitment that is not 128 hex", { ...good, bank: "1234" }],
    ["with an empty supplier", { ...good, supplier: "" }],
    ["with a number as supplier", { ...good, supplier: 7 }],
    ["with an amount in rand, not cents", { ...good, amount: { currency: "ZAR", minor: 500.5 } }],
    ["with a zero amount", { ...good, amount: { currency: "ZAR", minor: 0 } }],
    ["with a negative amount", { ...good, amount: { currency: "ZAR", minor: -1 } }],
    ["with an amount as text", { ...good, amount: { currency: "ZAR", minor: "500" } }],
    ["with a currency that is not ZAR", { ...good, amount: { currency: "USD", minor: 5 } }],
    ["with an unknown recommendation", { ...good, recommendation: "cheapest" }],
    ["without a recommendation", { ...good, recommendation: undefined }],
  ] as const)("rejects a payment.payout %s", (_name, payload) => {
    expect(
      parseEvent({ ...base, type: "payment.payout", payload: stripUndefined(payload) }).ok,
    ).toBe(false);
  });
});

describe("payment.approved payload", () => {
  const good = {
    bank: bank,
    payout,
    order: "Spaza restock",
    supplier: "Makro Soweto",
    amount,
    signature,
  };

  it("accepts the strict shape", () => {
    expect(parseEvent({ ...base, type: "payment.approved", payload: good }).ok).toBe(true);
  });

  it.each([
    ["without the payout id", { ...good, payout: undefined }],
    ["without a bank commitment", { ...good, bank: undefined }],
    ["with a payout id that is not 128 hex characters", { ...good, payout: "abcd" }],
    ["with an upper-case payout id", { ...good, payout: "CD".repeat(64) }],
    ["without a signature", { ...good, signature: undefined }],
    ["with an empty signature", { ...good, signature: "" }],
    ["with an amount in rand", { ...good, amount: { currency: "ZAR", minor: 500.5 } }],
    ["without a supplier", { ...good, supplier: undefined }],
  ] as const)("rejects a payment.approved %s", (_name, payload) => {
    expect(
      parseEvent({ ...base, type: "payment.approved", payload: stripUndefined(payload) }).ok,
    ).toBe(false);
  });
});

function stripUndefined(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}
