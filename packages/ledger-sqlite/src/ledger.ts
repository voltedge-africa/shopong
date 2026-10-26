import { DatabaseSync } from "node:sqlite";
import {
  accountType,
  err,
  isAccountSlug,
  isDebitNormal,
  isEventId,
  isMoney,
  money,
  ok,
  type AccountBalance,
  type AccountOptions,
  type AccountSlug,
  type Clock,
  type CurrencyCode,
  type Ledger,
  type LedgerEntry,
  type LedgerTransaction,
  type PortError,
  type PostError,
  type PostReceipt,
  type PostRequest,
  type Result,
  type TrialBalance,
} from "@shopong/ports";

export interface SqliteLedgerOptions {
  /** The ledger file on the OCN Node, from the Node's config. */
  readonly path: string;
  readonly clock: Clock;
}

export function openSqliteLedger(options: SqliteLedgerOptions): SqliteLedger {
  return new SqliteLedger(options);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  slug TEXT PRIMARY KEY,
  guarded INTEGER NOT NULL CHECK (guarded IN (0, 1))
) STRICT;
CREATE TABLE IF NOT EXISTS transactions (
  seq INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  body TEXT NOT NULL,
  description TEXT NOT NULL,
  metadata TEXT NOT NULL,
  posted_at INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS entries (
  transaction_seq INTEGER NOT NULL REFERENCES transactions(seq),
  position INTEGER NOT NULL,
  account TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
  currency TEXT NOT NULL,
  minor INTEGER NOT NULL CHECK (minor > 0),
  PRIMARY KEY (transaction_seq, position)
) STRICT;
CREATE INDEX IF NOT EXISTS entries_by_account ON entries (account, currency);
CREATE TRIGGER IF NOT EXISTS transactions_no_update BEFORE UPDATE ON transactions
  BEGIN SELECT RAISE(ABORT, 'posted transactions are never changed'); END;
CREATE TRIGGER IF NOT EXISTS transactions_no_delete BEFORE DELETE ON transactions
  BEGIN SELECT RAISE(ABORT, 'posted transactions are never deleted'); END;
CREATE TRIGGER IF NOT EXISTS entries_no_update BEFORE UPDATE ON entries
  BEGIN SELECT RAISE(ABORT, 'posted transactions are never changed'); END;
CREATE TRIGGER IF NOT EXISTS entries_no_delete BEFORE DELETE ON entries
  BEGIN SELECT RAISE(ABORT, 'posted transactions are never deleted'); END;
`;

/** Largest total the books store for one account or one currency; keeps every SUM readable. */
const LIMIT = BigInt(Number.MAX_SAFE_INTEGER);

interface StoredTransaction {
  readonly seq: number;
  readonly id: string;
  readonly idempotency_key: string;
  readonly body: string;
  readonly description: string;
  readonly metadata: string;
  readonly posted_at: number;
}

/** Exact totals, in minor units. */
interface Totals {
  debits: bigint;
  credits: bigint;
}

type Checked =
  | { readonly kind: "result"; readonly result: Result<PostReceipt, PostError> }
  | { readonly kind: "write" };

/** Ledger port on SQLite. One database transaction per post; balances are derived from entries. */
export class SqliteLedger implements Ledger {
  readonly #db: DatabaseSync;
  readonly #clock: Clock;
  #closed = false;

  constructor(options: SqliteLedgerOptions) {
    this.#clock = options.clock;
    this.#db = new DatabaseSync(options.path);
    try {
      this.#db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
      this.#db.exec(SCHEMA);
    } catch (error) {
      // Not a database, or unreadable: do not keep the handle open.
      this.#db.close();
      throw error;
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#db.close();
  }

  async configureAccount(
    account: AccountSlug,
    options: AccountOptions,
  ): Promise<Result<void, PortError<"invalid_request">>> {
    if (!isAccountSlug(account))
      return err("invalid_request", `bad account slug ${String(account)}`);
    if (typeof options?.guarded !== "boolean")
      return err("invalid_request", "guarded must be true or false");
    const current = this.#db.prepare("SELECT guarded FROM accounts WHERE slug = ?").get(account) as
      | { guarded: number }
      | undefined;
    // A guard may be turned on at any time, but not off once the account has entries.
    if (current?.guarded === 1 && !options.guarded && this.#hasEntries(account)) {
      return err("invalid_request", `${account} has entries and its guard cannot be turned off`);
    }
    this.#db
      .prepare(
        `INSERT INTO accounts (slug, guarded) VALUES (?, ?)
         ON CONFLICT (slug) DO UPDATE SET guarded = excluded.guarded`,
      )
      .run(account, options.guarded ? 1 : 0);
    return ok(undefined);
  }

  async post(request: PostRequest): Promise<Result<PostReceipt, PostError>> {
    const invalid = validate(request);
    if (invalid !== undefined) return err("invalid_request", invalid);
    const body = canonicalBody(request);

    return this.#inTransaction(() => {
      const checked = this.#check(request, body);
      if (checked.kind === "result") return checked.result;
      return ok({ transaction: this.#insert(request, body), replayed: false });
    });
  }

  /**
   * Runs `work` in one write transaction. BEGIN IMMEDIATE takes the write lock before the
   * checks, so the checks and the insert see the same balances. Any throw rolls back everything.
   */
  #inTransaction<T>(work: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE");
    let committed = false;
    try {
      const value = work();
      this.#db.exec("COMMIT");
      committed = true;
      return value;
    } finally {
      if (!committed) this.#db.exec("ROLLBACK");
    }
  }

  async findByIdempotencyKey(key: string): Promise<LedgerTransaction | undefined> {
    if (typeof key !== "string") throw new TypeError("idempotency key must be a string");
    const row = this.#storedByKey(key);
    return row === undefined ? undefined : this.#transactionFrom(row);
  }

  async balance(account: AccountSlug, currency: CurrencyCode): Promise<AccountBalance> {
    if (!isAccountSlug(account)) throw new TypeError(`bad account slug ${String(account)}`);
    if (!isMoney({ currency, minor: 0 })) throw new TypeError(`bad currency ${String(currency)}`);
    const totals = this.#totals(account, currency);
    return { account, balance: money(currency, Number(normalBalance(account, totals))) };
  }

  async trialBalance(): Promise<TrialBalance> {
    const rows = this.#db
      .prepare(
        `SELECT account, currency,
                SUM(CASE WHEN direction = 'debit' THEN minor ELSE 0 END) AS debits,
                SUM(CASE WHEN direction = 'credit' THEN minor ELSE 0 END) AS credits
         FROM entries GROUP BY account, currency ORDER BY account, currency`,
      )
      .all() as { account: string; currency: string; debits: number; credits: number }[];
    const totals = new Map<CurrencyCode, { debits: number; credits: number }>();
    for (const row of rows) {
      const sum = totals.get(row.currency) ?? { debits: 0, credits: 0 };
      sum.debits += row.debits;
      sum.credits += row.credits;
      totals.set(row.currency, sum);
    }
    return {
      lines: rows,
      totals: [...totals.entries()].map(([currency, sum]) => ({ currency, ...sum })),
    };
  }

  #check(request: PostRequest, body: string): Checked {
    const previous = this.#storedByKey(request.idempotencyKey);
    if (previous !== undefined) {
      return previous.body === body
        ? {
            kind: "result",
            result: ok({ transaction: this.#transactionFrom(previous), replayed: true }),
          }
        : {
            kind: "result",
            result: err("idempotency_conflict", "idempotency key reused with a different body"),
          };
    }

    // Exact arithmetic: a plain number cannot hold these sums above 2^53.
    const net = new Map<CurrencyCode, bigint>();
    for (const entry of request.entries) {
      const sign = entry.direction === "debit" ? 1n : -1n;
      const amount = BigInt(entry.amount.minor);
      net.set(entry.amount.currency, (net.get(entry.amount.currency) ?? 0n) + sign * amount);
    }
    for (const [currency, total] of net) {
      if (total !== 0n)
        return {
          kind: "result",
          result: err("unbalanced", `debits and credits differ by ${String(total)} ${currency}`),
        };
    }

    const deltas = new Map<string, Totals>();
    const currencyDeltas = new Map<CurrencyCode, Totals>();
    for (const entry of request.entries) {
      const amount = BigInt(entry.amount.minor);
      const key = `${entry.account}|${entry.amount.currency}`;
      const sum = deltas.get(key) ?? { debits: 0n, credits: 0n };
      const cur = currencyDeltas.get(entry.amount.currency) ?? { debits: 0n, credits: 0n };
      if (entry.direction === "debit") {
        sum.debits += amount;
        cur.debits += amount;
      } else {
        sum.credits += amount;
        cur.credits += amount;
      }
      deltas.set(key, sum);
      currencyDeltas.set(entry.amount.currency, cur);
    }

    // Every stored total stays within the safe-integer limit, so later SUMs are exact.
    for (const [key, delta] of deltas) {
      const split = key.indexOf("|");
      const account = key.slice(0, split);
      const currency = key.slice(split + 1);
      const current = this.#totals(account, currency);
      if (exceedsLimit(current, delta))
        return {
          kind: "result",
          result: err("invalid_request", `${account} total would exceed the safe-integer limit`),
        };
    }
    for (const [currency, delta] of currencyDeltas) {
      if (exceedsLimit(this.#currencyTotals(currency), delta))
        return {
          kind: "result",
          result: err("invalid_request", `${currency} total would exceed the safe-integer limit`),
        };
    }

    for (const [key, delta] of deltas) {
      const split = key.indexOf("|");
      const account = key.slice(0, split);
      const currency = key.slice(split + 1);
      if (!this.#isGuarded(account)) continue;
      const current = this.#totals(account, currency);
      const after = {
        debits: current.debits + delta.debits,
        credits: current.credits + delta.credits,
      };
      if (normalBalance(account, after) < 0n)
        return {
          kind: "result",
          result: err("insufficient_funds", `${account} would go below zero`),
        };
    }
    return { kind: "write" };
  }

  #insert(request: PostRequest, body: string): LedgerTransaction {
    const next = (
      this.#db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM transactions").get() as {
        next: number;
      }
    ).next;
    const postedAt = this.#clock.now();
    this.#db
      .prepare(
        `INSERT INTO transactions (seq, id, idempotency_key, body, description, metadata, posted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        next,
        `txn_${String(next)}`,
        request.idempotencyKey,
        body,
        request.description,
        JSON.stringify(request.metadata ?? {}),
        postedAt,
      );
    request.entries.forEach((entry, position) => {
      this.#db
        .prepare(
          `INSERT INTO entries (transaction_seq, position, account, direction, currency, minor)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          next,
          position,
          entry.account,
          entry.direction,
          entry.amount.currency,
          entry.amount.minor,
        );
    });
    const stored = this.#storedByKey(request.idempotencyKey);
    if (stored === undefined) throw new Error("transaction vanished inside its own write");
    return this.#transactionFrom(stored);
  }

  #storedByKey(key: string): StoredTransaction | undefined {
    return this.#db.prepare("SELECT * FROM transactions WHERE idempotency_key = ?").get(key) as
      | StoredTransaction
      | undefined;
  }

  #transactionFrom(row: StoredTransaction): LedgerTransaction {
    const entries = this.#db
      .prepare(
        "SELECT account, direction, currency, minor FROM entries WHERE transaction_seq = ? ORDER BY position",
      )
      .all(row.seq) as {
      account: string;
      direction: "debit" | "credit";
      currency: string;
      minor: number;
    }[];
    return {
      id: row.id,
      idempotencyKey: row.idempotency_key,
      description: row.description,
      metadata: JSON.parse(row.metadata) as Record<string, string>,
      entries: entries.map((entry): LedgerEntry => ({
        account: entry.account,
        direction: entry.direction,
        amount: money(entry.currency, entry.minor),
      })),
      postedAt: row.posted_at,
    };
  }

  #isGuarded(account: AccountSlug): boolean {
    const row = this.#db.prepare("SELECT guarded FROM accounts WHERE slug = ?").get(account) as
      | { guarded: number }
      | undefined;
    return row?.guarded === 1;
  }

  #hasEntries(account: AccountSlug): boolean {
    return (
      this.#db.prepare("SELECT 1 AS found FROM entries WHERE account = ? LIMIT 1").get(account) !==
      undefined
    );
  }

  #totals(account: AccountSlug, currency: CurrencyCode): Totals {
    const row = this.#db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN direction = 'debit' THEN minor ELSE 0 END), 0) AS debits,
                COALESCE(SUM(CASE WHEN direction = 'credit' THEN minor ELSE 0 END), 0) AS credits
         FROM entries WHERE account = ? AND currency = ?`,
      )
      .get(account, currency) as { debits: number; credits: number };
    return { debits: BigInt(row.debits), credits: BigInt(row.credits) };
  }

  #currencyTotals(currency: CurrencyCode): Totals {
    const row = this.#db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN direction = 'debit' THEN minor ELSE 0 END), 0) AS debits,
                COALESCE(SUM(CASE WHEN direction = 'credit' THEN minor ELSE 0 END), 0) AS credits
         FROM entries WHERE currency = ?`,
      )
      .get(currency) as { debits: number; credits: number };
    return { debits: BigInt(row.debits), credits: BigInt(row.credits) };
  }
}

/** True when adding `delta` to `current` would push debits or credits past the limit. */
function exceedsLimit(current: Totals, delta: Totals): boolean {
  return current.debits + delta.debits > LIMIT || current.credits + delta.credits > LIMIT;
}

function normalBalance(account: AccountSlug, totals: Totals): bigint {
  return isDebitNormal(accountType(account))
    ? totals.debits - totals.credits
    : totals.credits - totals.debits;
}

/** The posted body: what a replay must match. Keys are sorted so the text is canonical. */
function canonicalBody(request: PostRequest): string {
  return stableStringify({
    description: request.description,
    metadata: request.metadata ?? {},
    entries: request.entries.map((entry) => ({
      account: entry.account,
      direction: entry.direction,
      amount: { currency: entry.amount.currency, minor: entry.amount.minor },
    })),
  });
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, sortKeys(record[key])]),
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Checks a request of any shape. Returns a reason when it is not acceptable, never throws. */
function validate(input: unknown): string | undefined {
  if (!isRecord(input)) return "request must be an object";
  if (!isEventId(input.idempotencyKey))
    return "idempotency key must be an event id: 128 lowercase hex characters";
  if (typeof input.description !== "string") return "description must be a string";
  if (input.metadata !== undefined) {
    if (
      !isRecord(input.metadata) ||
      !Object.values(input.metadata).every((v) => typeof v === "string")
    )
      return "metadata must map strings to strings";
  }
  const entries = input.entries;
  if (!Array.isArray(entries)) return "entries must be an array";
  if (entries.length < 2) return "at least two entries";
  for (const entry of entries as unknown[]) {
    if (!isRecord(entry)) return "each entry must be an object";
    if (!isAccountSlug(entry.account)) return `bad account slug ${String(entry.account)}`;
    if (entry.direction !== "debit" && entry.direction !== "credit")
      return "direction must be debit or credit";
    if (!isMoney(entry.amount) || entry.amount.minor <= 0)
      return "amounts must be positive integer minor units";
  }
  return undefined;
}
