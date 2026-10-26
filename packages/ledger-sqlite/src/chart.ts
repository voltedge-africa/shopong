import { createHash } from "node:crypto";
import {
  err,
  ok,
  type AccountSlug,
  type Ledger,
  type PortError,
  type Result,
} from "@shopong/ports";

/**
 * The chart of accounts is per community (story 4.6 fix, triage log): one Node holds many communities on one ledger,
 * so every account of a community carries a scope derived from its community key. No account is shared across
 * communities, and no global name exists to post to by mistake.
 *
 * Shape: `<base>/<scope>` for the pool, supplier payable and fees, and `liabilities:member/<scope>/<member id>` for a
 * member. `<scope>` is the first 32 lowercase hex characters of SHA-256 of the community key.
 */
export const POOL_BASE = "assets:bank/pool";
export const SUPPLIER_PAYABLE_BASE = "liabilities:supplier/payable";
export const FEES_BASE = "income:fees";
export const MEMBER_BASE = "liabilities:member";

/** The bases a community's own chart has (member liabilities are added per member). */
export type ChartBase = typeof POOL_BASE | typeof SUPPLIER_PAYABLE_BASE | typeof FEES_BASE;

/** A community's scope: 32 hex characters, a function of its key only. */
export function communityScope(communityKey: string): string {
  if (typeof communityKey !== "string" || communityKey === "")
    throw new TypeError("community key must be a non-empty string");
  return createHash("sha256").update(communityKey, "utf8").digest("hex").slice(0, 32);
}

/** An opaque member id: lowercase hex of 32 or more characters (for example a SHA-512 or HMAC digest). */
const OPAQUE_MEMBER_ID = /^[0-9a-f]{32,}$/;

export function isOpaqueMemberId(memberId: unknown): memberId is string {
  return typeof memberId === "string" && OPAQUE_MEMBER_ID.test(memberId);
}

/** The account of one chart base in one community. */
export function chartAccount(communityKey: string, base: ChartBase): AccountSlug {
  return `${base}/${communityScope(communityKey)}`;
}

export const poolAccountOf = (communityKey: string): AccountSlug =>
  chartAccount(communityKey, POOL_BASE);
export const supplierPayableOf = (communityKey: string): AccountSlug =>
  chartAccount(communityKey, SUPPLIER_PAYABLE_BASE);
export const feesOf = (communityKey: string): AccountSlug => chartAccount(communityKey, FEES_BASE);

/** The liability account of one member of one community. Throws `TypeError` unless `memberId` is an opaque id. */
export function memberLiabilityOf(communityKey: string, memberId: string): AccountSlug {
  if (!isOpaqueMemberId(memberId))
    throw new TypeError("member id must be an opaque id: lowercase hex, 32 or more characters");
  return `${MEMBER_BASE}/${communityScope(communityKey)}/${memberId}`;
}

/**
 * Reads a slug back to its base and, for a member, its member id, for this community only. Undefined for any account
 * that does not belong to the community (another community's accounts included).
 */
export function splitAccount(
  communityKey: string,
  account: string,
): { readonly base: ChartBase | typeof MEMBER_BASE; readonly memberId?: string } | undefined {
  const scope = communityScope(communityKey);
  for (const base of [POOL_BASE, SUPPLIER_PAYABLE_BASE, FEES_BASE] as const) {
    if (account === `${base}/${scope}`) return { base };
  }
  const prefix = `${MEMBER_BASE}/${scope}/`;
  if (account.startsWith(prefix)) {
    const memberId = account.slice(prefix.length);
    return isOpaqueMemberId(memberId) ? { base: MEMBER_BASE, memberId } : undefined;
  }
  return undefined;
}

/** The fixed accounts of a community's chart, and whether each is guarded. */
export function chartOf(
  communityKey: string,
): readonly { account: AccountSlug; guarded: boolean }[] {
  return [
    { account: poolAccountOf(communityKey), guarded: true },
    { account: supplierPayableOf(communityKey), guarded: true },
    { account: feesOf(communityKey), guarded: false },
  ];
}

/** Configure the fixed accounts of one community's chart. */
export async function configureChart(
  ledger: Ledger,
  communityKey: string,
): Promise<Result<void, PortError<"invalid_request">>> {
  for (const { account, guarded } of chartOf(communityKey)) {
    const result = await ledger.configureAccount(account, { guarded });
    if (!result.ok) return result;
  }
  return ok(undefined);
}

/** Configure one member's liability account of one community as guarded (a member cannot withdraw more than paid in). */
export async function configureMemberAccount(
  ledger: Ledger,
  communityKey: string,
  memberId: string,
): Promise<Result<void, PortError<"invalid_request">>> {
  if (!isOpaqueMemberId(memberId))
    return err(
      "invalid_request",
      "member id must be an opaque id: lowercase hex, 32 or more characters",
    );
  return ledger.configureAccount(memberLiabilityOf(communityKey, memberId), { guarded: true });
}
