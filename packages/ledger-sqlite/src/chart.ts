import {
  err,
  ok,
  type AccountSlug,
  type Ledger,
  type PortError,
  type Result,
} from "@shopong/ports";

/**
 * The fixed chart of accounts for Demonstration 1 (decision 2A: fixed in code, not per
 * community). Member liabilities are added per member with `configureMemberAccount`.
 */
export const POOL_BANK: AccountSlug = "assets:bank/pool";
export const SUPPLIER_PAYABLE: AccountSlug = "liabilities:supplier/payable";
export const FEES: AccountSlug = "income:fees";

export interface ChartAccount {
  readonly account: AccountSlug;
  /** A guarded account's balance can never go below zero. */
  readonly guarded: boolean;
}

export const DEMONSTRATION_CHART: readonly ChartAccount[] = [
  { account: POOL_BANK, guarded: true },
  { account: SUPPLIER_PAYABLE, guarded: true },
  { account: FEES, guarded: false },
];

/**
 * An opaque member id: lowercase hex of 32 or more characters (for example a SHA-512 or HMAC
 * digest). Phone numbers, ID numbers and names are refused, so they never reach the books.
 */
const OPAQUE_MEMBER_ID = /^[0-9a-f]{32,}$/;

export function isOpaqueMemberId(memberId: unknown): memberId is string {
  return typeof memberId === "string" && OPAQUE_MEMBER_ID.test(memberId);
}

/** The liability account of one member. Throws `TypeError` unless `memberId` is an opaque id. */
export function memberLiability(memberId: string): AccountSlug {
  if (!isOpaqueMemberId(memberId))
    throw new TypeError("member id must be an opaque id: lowercase hex, 32 or more characters");
  return `liabilities:member/${memberId}`;
}

/** Configure the fixed accounts of the demonstration chart. */
export async function configureChart(
  ledger: Ledger,
): Promise<Result<void, PortError<"invalid_request">>> {
  for (const { account, guarded } of DEMONSTRATION_CHART) {
    const result = await ledger.configureAccount(account, { guarded });
    if (!result.ok) return result;
  }
  return ok(undefined);
}

/** Configure one member's liability account as guarded (a member cannot withdraw more than paid in). */
export async function configureMemberAccount(
  ledger: Ledger,
  memberId: string,
): Promise<Result<void, PortError<"invalid_request">>> {
  if (!isOpaqueMemberId(memberId))
    return err(
      "invalid_request",
      "member id must be an opaque id: lowercase hex, 32 or more characters",
    );
  return ledger.configureAccount(memberLiability(memberId), { guarded: true });
}
