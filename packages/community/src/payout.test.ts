// Approve and pay a supplier from the pool (story 4.7): the pure rules. Rows are the money and security rows of the plan.
// Apply-level and Node-level rows are in payout-apply.test.ts and apps/node/src/payouts.test.ts.
import { canonicalBytes } from "@shopong/events";
import { describe, expect, it } from "vite-plus/test";
import {
  APPROVALS_RANGE,
  DEFAULT_APPROVALS,
  approvalBytes,
  checkApprovalsSetting,
  choosePayoutSupplier,
  notEnoughApprovalsMessage,
  payoutRule,
  shortfallMessage,
  type PayoutTerms,
} from "./payout.js";
import type { Ranking } from "./rank.js";

const BANK = "12".repeat(64);
const terms: PayoutTerms = {
  order: "Spaza restock",
  supplier: "Makro Soweto",
  amountMinor: 50000,
  bank: BANK,
};
const SPACE = "ab".repeat(32);
const PAYOUT = "cd".repeat(64);
const ALICE = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
const BOB = "did:key:z6MkmtmqQWNzwamfa7QWkNU3Sk2qHpuXK4VrfMXXqVouVZtL";

describe("the approvals setting (question 1, option C)", () => {
  it("is 1 to 5, with two as the default", () => {
    expect(APPROVALS_RANGE).toEqual({ min: 1, max: 5 });
    expect(DEFAULT_APPROVALS).toBe(2);
  });

  it.each([1, 2, 3, 4, 5])("accepts %i", (n) => {
    expect(checkApprovalsSetting(n)).toBe(n);
  });

  it.each([
    ["zero", 0],
    ["six", 6],
    ["a negative number", -1],
    ["a fraction", 2.5],
    ["text", "2"],
    ["null", null],
    ["NaN", Number.NaN],
    ["an unsafe integer", 2 ** 60],
    ["an object", { value: 2 }],
  ])("refuses %s", (_name, value) => {
    expect(checkApprovalsSetting(value)).toBeUndefined();
  });
});

describe("the payout rule (pure)", () => {
  it("passes when enough distinct approvers count and the pool covers the amount", () => {
    expect(
      payoutRule({
        required: 2,
        approvers: [ALICE, BOB],
        refused: [],
        amountMinor: 50000,
        poolMinor: 50000n,
      }),
    ).toEqual({ ok: true });
  });

  it("refuses one approval when two are needed, and nothing is paid", () => {
    const result = payoutRule({
      required: 2,
      approvers: [ALICE],
      refused: [],
      amountMinor: 50000,
      poolMinor: 90000n,
    });
    expect(result).toEqual({
      ok: false,
      problem: "not_enough_approvals",
      message: "Two people must approve this payment.",
    });
  });

  it("shows the plain reason of the first refused approval when the count is short", () => {
    const result = payoutRule({
      required: 2,
      approvers: [ALICE],
      refused: ["Your role ended on 1 January 2027."],
      amountMinor: 50000,
      poolMinor: 90000n,
    });
    expect(result).toEqual({
      ok: false,
      problem: "not_enough_approvals",
      message: "Your role ended on 1 January 2027.",
    });
  });

  it("refuses short funds with both amounts in cents-exact rand", () => {
    const result = payoutRule({
      required: 2,
      approvers: [ALICE, BOB],
      refused: [],
      amountMinor: 50000,
      poolMinor: 30000n,
    });
    expect(result).toEqual({
      ok: false,
      problem: "short_funds",
      message: "The pool has R300.00; this payment needs R500.00. Nothing was paid.",
    });
  });

  it("checks the count before the funds", () => {
    const result = payoutRule({
      required: 2,
      approvers: [],
      refused: [],
      amountMinor: 50000,
      poolMinor: 0n,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toBe("not_enough_approvals");
  });

  it.each([1, 2, 3, 4, 5])("reads the wording for a rule of %i approvals", (n) => {
    const words = ["", "One person", "Two people", "Three people", "Four people", "Five people"];
    const text = notEnoughApprovalsMessage(n);
    expect(text.startsWith(n === 1 ? "One person must" : `${words[n]!.split(" ")[0]}`)).toBe(true);
    expect(text.endsWith("approve this payment.")).toBe(true);
  });

  it("uses the same money words as the pool", () => {
    expect(shortfallMessage(30000n, 50000)).toBe(
      "The pool has R300.00; this payment needs R500.00. Nothing was paid.",
    );
  });
});

describe("the approval signature", () => {
  it("is domain-tagged and covers the community, the payment and the approver", () => {
    const bytes = new TextDecoder().decode(approvalBytes(SPACE, PAYOUT, ALICE, terms));
    expect(bytes.startsWith('{"amountMinor":50000')).toBe(true);
    expect(bytes).toContain('"tag":"ocn-approval/v1"');
    expect(bytes).toContain(SPACE);
    expect(bytes).toContain(PAYOUT);
    expect(bytes).toContain(ALICE);
  });

  it("differs when any signed field differs, so one approval cannot stand for another", () => {
    const base = approvalBytes(SPACE, PAYOUT, ALICE, terms);
    const variants = [
      approvalBytes("ef".repeat(32), PAYOUT, ALICE, terms),
      approvalBytes(SPACE, "ef".repeat(64), ALICE, terms),
      approvalBytes(SPACE, PAYOUT, BOB, terms),
      approvalBytes(SPACE, PAYOUT, ALICE, { ...terms, amountMinor: 50001 }),
      approvalBytes(SPACE, PAYOUT, ALICE, { ...terms, supplier: "Other" }),
      approvalBytes(SPACE, PAYOUT, ALICE, { ...terms, order: "Other" }),
      approvalBytes(SPACE, PAYOUT, ALICE, { ...terms, bank: "34".repeat(64) }),
    ];
    for (const variant of variants) expect(variant).not.toEqual(base);
  });

  it("is the canonical JSON of its fields, so every device signs the same bytes", () => {
    expect(approvalBytes(SPACE, PAYOUT, ALICE, terms)).toEqual(
      canonicalBytes({
        tag: "ocn-approval/v1",
        space: SPACE,
        payout: PAYOUT,
        approver: ALICE,
        order: terms.order,
        supplier: terms.supplier,
        amountMinor: terms.amountMinor,
        bank: terms.bank,
      }),
    );
  });
});

/** A ranking with the given complete quotes, sorted as `rankQuotes` sorts them. */
function ranking(
  recommendation: Ranking["recommendation"],
  suppliers: readonly { supplier: string; totalCents: number }[] = [],
): Ranking {
  return {
    ranked: suppliers.map((s, i) => ({
      rank: i + 1,
      supplier: s.supplier,
      totalCents: s.totalCents,
      delivery: { feeCents: 0, days: 0 },
    })),
    incomplete: [],
    recommendation,
  };
}

describe("choosing the supplier to pay", () => {
  it("pays the clear winner without a pick, and records 'clear'", () => {
    const chosen = choosePayoutSupplier(
      ranking({ kind: "clear", supplier: "Makro Soweto" }, [
        { supplier: "Makro Soweto", totalCents: 50000 },
        { supplier: "Spar Depot", totalCents: 60000 },
      ]),
    );
    expect(chosen).toEqual({
      ok: true,
      value: { supplier: "Makro Soweto", amountMinor: 50000, recommendation: "clear" },
    });
  });

  it("refuses a pick other than the clear winner", () => {
    const chosen = choosePayoutSupplier(
      ranking({ kind: "clear", supplier: "Makro Soweto" }, [
        { supplier: "Makro Soweto", totalCents: 50000 },
        { supplier: "Spar Depot", totalCents: 60000 },
      ]),
      "Spar Depot",
    );
    expect(chosen).toEqual({
      ok: false,
      message: "The lowest quote is Makro Soweto, so that is the one to pay.",
    });
  });

  it("needs a pick when the ranking is too close, and records the ranking it was judged on", () => {
    const suppliers = [
      { supplier: "Makro Soweto", totalCents: 50000 },
      { supplier: "Spar Depot", totalCents: 51000 },
    ];
    expect(choosePayoutSupplier(ranking({ kind: "too_close" }, suppliers))).toEqual({
      ok: false,
      message: "Choose a supplier first.",
    });
    expect(choosePayoutSupplier(ranking({ kind: "too_close" }, suppliers), "Spar Depot")).toEqual({
      ok: true,
      value: { supplier: "Spar Depot", amountMinor: 51000, recommendation: "too_close" },
    });
  });

  it("pays the one complete quote when only one is ranked, if the treasurer picks it", () => {
    expect(
      choosePayoutSupplier(
        ranking({ kind: "only_one" }, [{ supplier: "A", totalCents: 900 }]),
        "A",
      ),
    ).toEqual({ ok: true, value: { supplier: "A", amountMinor: 900, recommendation: "only_one" } });
  });

  it("refuses a supplier with no complete quote, and nothing when there is none", () => {
    expect(
      choosePayoutSupplier(ranking({ kind: "too_close" }, [{ supplier: "A", totalCents: 9 }]), "B"),
    ).toEqual({ ok: false, message: "There is no quote from that supplier for this order." });
    expect(choosePayoutSupplier(ranking({ kind: "none" }))).toEqual({
      ok: false,
      message: "Choose a supplier first.",
    });
  });
});

describe("one person counts once [S-4.7 gaps]", () => {
  it("the same DID listed twice is one approver, even as creator and co-treasurer", () => {
    expect(
      payoutRule({
        required: 2,
        approvers: [ALICE, ALICE],
        refused: [],
        amountMinor: 50000,
        poolMinor: 90000n,
      }),
    ).toEqual({
      ok: false,
      problem: "not_enough_approvals",
      message: "Two people must approve this payment.",
    });
  });
});
