// Approve and pay a supplier from the pool (story 4.7). The pure rules, shared by `apply` (the record, at log time),
// the phone (choosing the supplier, the confirmation words) and the OCN Node (the payout, at the Node's clock).
//
// The number of approvals is a per-community setting, written once in the founding event (`settings/approvals`, 1 to 5,
// default 2). A payment needs that many distinct people to approve it. Each approval is its own `payment.approved`
// record event, signed by the approver with a domain tag (`ocn-approval/v1`), naming the payment's record event id.
// The creator counts as one approver without a limit; any other approver must hold `payment/approve` with a rand limit
// at least the amount, at the time of judgement. An approval is judged again by the Node at its own clock.
//
// The payment's id is the record event id of its `payment.payout`. The Node posts the ledger entry and creates the
// payout keyed by that id (AGENTS rule 5).

import { canonicalBytes } from "@shopong/events";
import type { Money, ViewReader } from "@shopong/ports";
import { checkAction, type RoleError } from "./roles.js";
import type { Ranking } from "./rank.js";
import { randText } from "./pool.js";
import type { CapabilityAuth, Did, EpochMs } from "@shopong/ports";

/** The record key of the approvals setting, written by the founding `member.joined`. */
export const APPROVALS_KEY = "settings/approvals";
export const DEFAULT_APPROVALS = 2;
export const APPROVALS_RANGE = { min: 1, max: 5 } as const;
/** The domain tag every approval signature covers (closes S-2.5-14 for approvals). */
export const APPROVAL_TAG = "ocn-approval/v1";
export const PAYOUT_TYPE = "payment.payout";
export const APPROVAL_TYPE = "payment.approved";
export const PAYOUT_RECOMMENDATIONS = ["clear", "too_close", "only_one", "none"] as const;
export type PayoutRecommendation = (typeof PAYOUT_RECOMMENDATIONS)[number];

/** The plain sentences a person sees for the payment. */
export const PAYOUT_MESSAGES = {
  approvals_invalid: "The number of approvals must be a whole number from 1 to 5.",
  not_permitted: "Only the treasurer can pay a supplier.",
  bad_payment: "This payment is not in the form the record expects.",
  no_quote: "There is no quote from that supplier for this order.",
  unknown_payment: "This payment is not in the record.",
  mismatch: "This approval is for a different payment.",
  already_approved: "You have already approved this payment.",
  not_signed: "This approval isn't signed by the person it names.",
  not_member: "Only a member can approve a payment.",
  approval_unreadable: "This approval can't be read.",
} as const;

export interface PayoutTerms {
  readonly order: string;
  readonly supplier: string;
  /** Whole rand cents, above zero. */
  readonly amountMinor: number;
  /**
   * The keyed commitment of the supplier's bank details (`bankCommitmentOf` on the Node, 128 lowercase hex). The approvers
   * sign it, so the details cannot change after the approvals without a new approval (S-4.7 fix 3).
   */
  readonly bank: string;
}

/** Whether a value is a valid approvals setting. Only a whole number from 1 to 5 is; text is refused, not converted. */
export function checkApprovalsSetting(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return undefined;
  if (value < APPROVALS_RANGE.min || value > APPROVALS_RANGE.max) return undefined;
  return value;
}

/** The approvals a payment needs in this community: the recorded setting, or the default when none is recorded. */
export async function approvalsOf(view: ViewReader): Promise<number> {
  const value = await view.get(APPROVALS_KEY);
  return checkApprovalsSetting(value) ?? DEFAULT_APPROVALS;
}

const COUNT_WORDS = ["", "One", "Two", "Three", "Four", "Five"] as const;

/** The sentence when too few people have approved: "Two people must approve this payment." */
export function notEnoughApprovalsMessage(required: number): string {
  const count = COUNT_WORDS[required] ?? String(required);
  return required === 1
    ? `${count} person must approve this payment.`
    : `${count} people must approve this payment.`;
}

/** The sentence when the pool is short: both amounts, in exact rand and cents, and that nothing was paid. */
export function shortfallMessage(poolMinor: bigint, amountMinor: number): string {
  return `The pool has ${randText(poolMinor)}; this payment needs ${randText(BigInt(amountMinor))}. Nothing was paid.`;
}

export type PayoutRuleResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly problem: "not_enough_approvals" | "short_funds";
      readonly message: string;
    };

/**
 * The pure payout rule. `approvers` are the distinct approvers that still stand at the judging time; `refused` are the
 * plain reasons of the approvals that did not. Nothing is paid unless both checks pass.
 */
export function payoutRule(input: {
  readonly required: number;
  readonly approvers: readonly string[];
  readonly refused: readonly string[];
  readonly amountMinor: number;
  readonly poolMinor: bigint;
}): PayoutRuleResult {
  const distinct = new Set(input.approvers).size;
  if (distinct < input.required) {
    return {
      ok: false,
      problem: "not_enough_approvals",
      message: input.refused[0] ?? notEnoughApprovalsMessage(input.required),
    };
  }
  if (input.poolMinor < BigInt(input.amountMinor)) {
    return {
      ok: false,
      problem: "short_funds",
      message: shortfallMessage(input.poolMinor, input.amountMinor),
    };
  }
  return { ok: true };
}

/** The record key of a payment, and of each approval of it (one per approver). */
export const payoutKey = (payout: string) => `payouts/${payout}`;
export const approvalsPrefix = (payout: string) => `approvals/${payout}/`;
export const approvalKey = (payout: string, approver: string) => `approvals/${payout}/${approver}`;

/**
 * The bytes an approver signs: the domain tag, the community, the payment and the terms, as canonical JSON. A signature
 * for one community, payment, approver or amount does not verify for any other.
 */
export function approvalBytes(
  space: string,
  payout: string,
  approver: string,
  terms: PayoutTerms,
): Uint8Array {
  return canonicalBytes({
    tag: APPROVAL_TAG,
    space,
    payout,
    approver,
    order: terms.order,
    supplier: terms.supplier,
    amountMinor: terms.amountMinor,
    bank: terms.bank,
  });
}

/** What a phone or the Node may check about a payment's terms: the fields, and whole rand cents in ZAR. */
export function termsOf(input: unknown): PayoutTerms | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined;
  const { order, supplier, amount, bank } = input as Record<string, unknown>;
  if (typeof bank !== "string" || !BANK_COMMITMENT.test(bank)) return undefined;
  if (typeof order !== "string" || order === "" || typeof supplier !== "string" || supplier === "")
    return undefined;
  if (typeof amount !== "object" || amount === null || Array.isArray(amount)) return undefined;
  const { currency, minor } = amount as Record<string, unknown>;
  if (currency !== "ZAR" || typeof minor !== "number" || !Number.isSafeInteger(minor) || minor < 1)
    return undefined;
  return { order, supplier, amountMinor: minor, bank };
}

/** A bank commitment: SHA-512 as 128 lowercase hex characters. */
export const BANK_COMMITMENT = /^[0-9a-f]{128}$/u;

/**
 * Whether an approver's authority covers paying `amountMinor` at `at`. The creator is always covered (no role, no limit).
 * Any other person must be a member and hold `payment/approve` with a limit at least the amount. Returns the plain
 * reason, or undefined when it stands.
 */
export async function approverStanding(
  ctx: {
    readonly auth: CapabilityAuth;
    readonly creator: Did;
    readonly spaceKey: string;
    readonly view: ViewReader;
  },
  approver: string,
  amountMinor: number,
  at: EpochMs,
): Promise<string | undefined> {
  if (approver === ctx.creator) return undefined;
  if ((await ctx.view.get(`members/${approver}`)) === undefined) return PAYOUT_MESSAGES.not_member;
  const amount: Money = { currency: "ZAR", minor: amountMinor };
  const checked = await checkAction(ctx, approver, { ability: "payment/approve", amount }, at);
  if (checked.ok) return undefined;
  return (checked as { error: RoleError }).error.message;
}

/**
 * The supplier a payment pays, from the ranking (story 6.9). A clear ranking pays its winner and no other supplier. Any
 * other ranking needs the treasurer to pick one of the complete quotes. The recommendation is recorded with the payment.
 */
export function choosePayoutSupplier(
  ranking: Ranking,
  pick?: string,
):
  | {
      ok: true;
      value: { supplier: string; amountMinor: number; recommendation: PayoutRecommendation };
    }
  | { ok: false; message: string } {
  const kind = ranking.recommendation.kind;
  const recommendation = kind as PayoutRecommendation;
  if (kind === "clear") {
    const winner = ranking.recommendation.supplier;
    if (pick !== undefined && pick !== winner) {
      return { ok: false, message: `The lowest quote is ${winner}, so that is the one to pay.` };
    }
    const row = ranking.ranked.find((r) => r.supplier === winner);
    if (row === undefined) return { ok: false, message: PAYOUT_MESSAGES.no_quote };
    return { ok: true, value: { supplier: winner, amountMinor: row.totalCents, recommendation } };
  }
  if (pick === undefined) return { ok: false, message: "Choose a supplier first." };
  const row = ranking.ranked.find((r) => r.supplier === pick);
  if (row === undefined) return { ok: false, message: PAYOUT_MESSAGES.no_quote };
  return { ok: true, value: { supplier: pick, amountMinor: row.totalCents, recommendation } };
}
