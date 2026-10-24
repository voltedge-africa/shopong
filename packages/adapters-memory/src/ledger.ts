import {
  accountType,
  err,
  isAccountSlug,
  isDebitNormal,
  isMoney,
  money,
  ok,
  type AccountBalance,
  type AccountOptions,
  type AccountSlug,
  type Clock,
  type CurrencyCode,
  type IdGenerator,
  type Ledger,
  type LedgerEntry,
  type LedgerTransaction,
  type PortError,
  type PostError,
  type PostReceipt,
  type PostRequest,
  type Result,
  type TrialBalance,
  type TrialBalanceLine,
} from "@shopong/ports";
import { createCounterIds, createManualClock, stableStringify } from "./support.js";

export interface MemoryLedgerOptions {
  clock?: Clock;
  ids?: IdGenerator;
}

interface Totals {
  debits: number;
  credits: number;
}

/** In-memory `Ledger` with Ledfra's rules: balanced, immutable, idempotent, guarded accounts. */
export class MemoryLedger implements Ledger {
  readonly #clock: Clock;
  readonly #ids: IdGenerator;
  readonly #guarded = new Set<AccountSlug>();
  readonly #byKey = new Map<string, { body: string; transaction: LedgerTransaction }>();
  /** `account|currency` to running totals. */
  readonly #totals = new Map<string, Totals>();

  constructor(options: MemoryLedgerOptions = {}) {
    this.#clock = options.clock ?? createManualClock();
    this.#ids = options.ids ?? createCounterIds();
  }

  async configureAccount(
    account: AccountSlug,
    options: AccountOptions,
  ): Promise<Result<void, PortError<"invalid_request">>> {
    if (!isAccountSlug(account))
      return err("invalid_request", `bad account slug ${String(account)}`);
    if (options.guarded) this.#guarded.add(account);
    else this.#guarded.delete(account);
    return ok(undefined);
  }

  async post(request: PostRequest): Promise<Result<PostReceipt, PostError>> {
    const invalid = validate(request);
    if (invalid !== undefined) return err("invalid_request", invalid);

    const body = stableStringify({
      description: request.description,
      metadata: request.metadata ?? {},
      entries: request.entries,
    });
    const previous = this.#byKey.get(request.idempotencyKey);
    if (previous !== undefined) {
      return previous.body === body
        ? ok({ transaction: previous.transaction, replayed: true })
        : err("idempotency_conflict", "idempotency key reused with a different body");
    }

    const net = new Map<CurrencyCode, number>();
    for (const entry of request.entries) {
      const sign = entry.direction === "debit" ? 1 : -1;
      net.set(
        entry.amount.currency,
        (net.get(entry.amount.currency) ?? 0) + sign * entry.amount.minor,
      );
    }
    for (const [currency, total] of net) {
      if (total !== 0)
        return err("unbalanced", `debits and credits differ by ${String(total)} ${currency}`);
    }

    const next = new Map<string, Totals>();
    for (const entry of request.entries) {
      const key = `${entry.account}|${entry.amount.currency}`;
      const current = next.get(key) ?? { ...(this.#totals.get(key) ?? { debits: 0, credits: 0 }) };
      if (entry.direction === "debit") current.debits += entry.amount.minor;
      else current.credits += entry.amount.minor;
      next.set(key, current);
    }
    for (const [key, totals] of next) {
      const account = key.slice(0, key.indexOf("|"));
      if (this.#guarded.has(account) && normalBalance(account, totals) < 0) {
        return err("insufficient_funds", `${account} would go below zero`);
      }
    }

    for (const [key, totals] of next) this.#totals.set(key, totals);
    const transaction: LedgerTransaction = {
      id: this.#ids.next("txn"),
      idempotencyKey: request.idempotencyKey,
      description: request.description,
      metadata: { ...request.metadata },
      entries: request.entries.map((entry) => ({ ...entry, amount: { ...entry.amount } })),
      postedAt: this.#clock.now(),
    };
    this.#byKey.set(request.idempotencyKey, { body, transaction });
    return ok({ transaction, replayed: false });
  }

  async findByIdempotencyKey(key: string): Promise<LedgerTransaction | undefined> {
    return this.#byKey.get(key)?.transaction;
  }

  async balance(account: AccountSlug, currency: CurrencyCode): Promise<AccountBalance> {
    const totals = this.#totals.get(`${account}|${currency}`) ?? { debits: 0, credits: 0 };
    return { account, balance: money(currency, normalBalance(account, totals)) };
  }

  async trialBalance(): Promise<TrialBalance> {
    const lines: TrialBalanceLine[] = [...this.#totals.entries()]
      .map(([key, totals]) => {
        const split = key.indexOf("|");
        return { account: key.slice(0, split), currency: key.slice(split + 1), ...totals };
      })
      .sort((a, b) =>
        a.account === b.account ? cmp(a.currency, b.currency) : cmp(a.account, b.account),
      );
    const totals = new Map<CurrencyCode, Totals>();
    for (const line of lines) {
      const sum = totals.get(line.currency) ?? { debits: 0, credits: 0 };
      sum.debits += line.debits;
      sum.credits += line.credits;
      totals.set(line.currency, sum);
    }
    return {
      lines,
      totals: [...totals.entries()]
        .sort(([a], [b]) => cmp(a, b))
        .map(([currency, sum]) => ({ currency, ...sum })),
    };
  }
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalBalance(account: AccountSlug, totals: Totals): number {
  return isDebitNormal(accountType(account))
    ? totals.debits - totals.credits
    : totals.credits - totals.debits;
}

function validate(request: PostRequest): string | undefined {
  if (typeof request.idempotencyKey !== "string" || request.idempotencyKey.length === 0) {
    return "idempotency key required";
  }
  if (request.entries.length < 2) return "at least two entries";
  for (const entry of request.entries as readonly LedgerEntry[]) {
    if (!isAccountSlug(entry.account)) return `bad account slug ${String(entry.account)}`;
    if (entry.direction !== "debit" && entry.direction !== "credit")
      return "direction must be debit or credit";
    if (!isMoney(entry.amount) || entry.amount.minor <= 0)
      return "amounts must be positive integer minor units";
  }
  return undefined;
}
