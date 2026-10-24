import type { CurrencyCode, EpochMs, Money, PortError, Result } from "./common.js";

/** The five account types; an account slug starts with one of them. */
export type AccountType = "assets" | "liabilities" | "equity" | "income" | "expenses";

export const ACCOUNT_TYPES: readonly AccountType[] = [
  "assets",
  "liabilities",
  "equity",
  "income",
  "expenses",
];

/**
 * An account slug `<type>:<path>`, for example `assets:bank/pool` or
 * `liabilities:member/abc123`. Lowercase letters, digits and `/ _ - .` in the path.
 * Accounts are created on first reference.
 */
export type AccountSlug = string;

const ACCOUNT_SLUG = /^(assets|liabilities|equity|income|expenses):[a-z0-9][a-z0-9/_.-]*$/;

export function isAccountSlug(value: unknown): value is AccountSlug {
  return typeof value === "string" && ACCOUNT_SLUG.test(value);
}

export function accountType(slug: AccountSlug): AccountType {
  return slug.slice(0, slug.indexOf(":")) as AccountType;
}

/** Whether an account type's balance grows with debits (assets, expenses) or credits (the rest). */
export function isDebitNormal(type: AccountType): boolean {
  return type === "assets" || type === "expenses";
}

export type Direction = "debit" | "credit";

export interface LedgerEntry {
  readonly account: AccountSlug;
  readonly direction: Direction;
  /** Strictly positive. */
  readonly amount: Money;
}

export interface PostRequest {
  /** Normally the event id of the money event (AGENTS.md rule 5). */
  readonly idempotencyKey: string;
  readonly description: string;
  /** Opaque ids only, never PII (for example `{ eventSha512, spaceKey }`). */
  readonly metadata?: { readonly [key: string]: string };
  /** At least two entries; debits equal credits per currency. */
  readonly entries: readonly LedgerEntry[];
}

export interface LedgerTransaction {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly description: string;
  readonly metadata: { readonly [key: string]: string };
  readonly entries: readonly LedgerEntry[];
  readonly postedAt: EpochMs;
}

export interface PostReceipt {
  readonly transaction: LedgerTransaction;
  /** True when this key was already posted with the same body; no new transaction was made. */
  readonly replayed: boolean;
}

export type PostErrorCode =
  /** Malformed request: bad slug, non-positive amount, fewer than two entries. */
  | "invalid_request"
  /** Debits and credits differ for at least one currency. */
  | "unbalanced"
  /** The key was used before with a different body. */
  | "idempotency_conflict"
  /** A guarded account would fall below zero. */
  | "insufficient_funds";

export type PostError = PortError<PostErrorCode>;

export interface AccountOptions {
  /** A guarded account's balance can never go below zero. */
  readonly guarded: boolean;
}

/** Balance in the account's normal direction (see `isDebitNormal`). May be negative if unguarded. */
export interface AccountBalance {
  readonly account: AccountSlug;
  readonly balance: Money;
}

export interface TrialBalanceLine {
  readonly account: AccountSlug;
  readonly currency: CurrencyCode;
  /** Total debits posted, in minor units. */
  readonly debits: number;
  /** Total credits posted, in minor units. */
  readonly credits: number;
}

export interface TrialBalance {
  /** One line per account and currency that has entries, sorted by account then currency. */
  readonly lines: readonly TrialBalanceLine[];
  /** Totals per currency; debits always equal credits. */
  readonly totals: readonly { currency: CurrencyCode; debits: number; credits: number }[];
}

/**
 * Double-entry books for money (Ledfra). The OCN Node is the only writer. Owning epic: 4.
 *
 * Every adapter must: reject unbalanced transactions; treat the same key with the same
 * body as a replay that creates nothing; reject the same key with a different body; keep
 * guarded accounts at or above zero; never change a posted transaction.
 */
export interface Ledger {
  /** Configure an account (created if new). Guarding applies to postings after the call. */
  configureAccount(
    account: AccountSlug,
    options: AccountOptions,
  ): Promise<Result<void, PortError<"invalid_request">>>;
  post(request: PostRequest): Promise<Result<PostReceipt, PostError>>;
  /** The transaction posted with this idempotency key, for reconciliation by event id. */
  findByIdempotencyKey(key: string): Promise<LedgerTransaction | undefined>;
  /** Balance of one account in one currency; zero for an account never referenced. */
  balance(account: AccountSlug, currency: CurrencyCode): Promise<AccountBalance>;
  trialBalance(): Promise<TrialBalance>;
}
