// The Ledger contract, then the I/O matrix rows the contract does not cover: restart, atomicity,
// the overdraw race, and the rule that posted transactions are never changed or deleted.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { money, type Clock, type LedgerEntry, type PostRequest } from "@shopong/ports";
import {
  expectErr,
  expectOk,
  randomEventId,
  runLedgerContract,
  unique,
} from "@shopong/ports-contract";
import {
  FEES,
  POOL_BANK,
  SUPPLIER_PAYABLE,
  configureChart,
  configureMemberAccount,
  memberLiability,
  openSqliteLedger,
  type SqliteLedger,
} from "./index.js";

const clock: Clock = { now: () => 1_750_000_000_000 };
const opened: SqliteLedger[] = [];
const dirs: string[] = [];

afterAll(() => {
  for (const ledger of opened) ledger.close();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function ledgerFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "ledger-sqlite-"));
  dirs.push(dir);
  return join(dir, "ledger.sqlite");
}

function openLedger(path: string = ledgerFile()): SqliteLedger {
  const ledger = openSqliteLedger({ path, clock });
  opened.push(ledger);
  return ledger;
}

runLedgerContract(() => openLedger());

const debit = (account: string, minor: number): LedgerEntry => ({
  account,
  direction: "debit",
  amount: money("ZAR", minor),
});
const credit = (account: string, minor: number): LedgerEntry => ({
  account,
  direction: "credit",
  amount: money("ZAR", minor),
});

function accounts() {
  const run = unique("t");
  return {
    pool: `assets:bank/${run}`,
    member: `liabilities:member/${run}`,
    supplier: `liabilities:supplier/${run}`,
    fees: `income:fees/${run}`,
  };
}

function contribution(a: ReturnType<typeof accounts>, minor: number, key = randomEventId()) {
  return {
    idempotencyKey: key,
    description: "member contribution",
    metadata: { eventSha512: key },
    entries: [debit(a.pool, minor), credit(a.member, minor)],
  } satisfies PostRequest;
}

const HEX64 = "0123456789abcdef".repeat(4);

function refundFrom(ledger: SqliteLedger, a: ReturnType<typeof accounts>, minor: number) {
  return ledger.post(refund(a, minor));
}

function refund(a: ReturnType<typeof accounts>, minor: number, key = randomEventId()) {
  return {
    idempotencyKey: key,
    description: "refund",
    entries: [debit(a.member, minor), credit(a.pool, minor)],
  } satisfies PostRequest;
}

describe("SqliteLedger: rows of the I/O matrix the contract does not cover", () => {
  it("restart: balances, trial balance, keys, guards and ids are unchanged after reopening the file", async () => {
    const path = ledgerFile();
    const first = openLedger(path);
    const a = accounts();
    expectOk(await first.configureAccount(a.member, { guarded: true }));
    const request = contribution(a, 250_00);
    const receipt = expectOk(await first.post(request));
    const balanceBefore = await first.balance(a.pool, "ZAR");
    const trialBefore = await first.trialBalance();
    first.close();

    const second = openLedger(path);
    expect(await second.findByIdempotencyKey(request.idempotencyKey)).toEqual(receipt.transaction);
    expect(await second.balance(a.pool, "ZAR")).toEqual(balanceBefore);
    expect(await second.trialBalance()).toEqual(trialBefore);

    const replay = expectOk(await second.post(request));
    expect(replay).toEqual({ transaction: receipt.transaction, replayed: true });
    expectErr(await second.post(refund(a, 300_00)), "insufficient_funds");

    const next = expectOk(await second.post(contribution(a, 10_00)));
    expect(next.transaction.id).not.toBe(receipt.transaction.id);
  });

  it("atomicity: a failure part-way through a post stores nothing, and the key stays free", async () => {
    const path = ledgerFile();
    const ledger = openLedger(path);
    const a = accounts();
    const request = contribution(a, 100_00);

    // Fail the second entry of the post, after the transaction row and the first entry are written.
    const side = new DatabaseSync(path);
    side.exec(
      `CREATE TRIGGER fail_second_entry BEFORE INSERT ON entries
         WHEN NEW.account = '${a.member}'
         BEGIN SELECT RAISE(ABORT, 'injected failure'); END;`,
    );
    await expect(ledger.post(request)).rejects.toThrow(/injected failure/);
    side.exec("DROP TRIGGER fail_second_entry");
    side.close();

    expect(await ledger.findByIdempotencyKey(request.idempotencyKey)).toBeUndefined();
    expect(await ledger.balance(a.pool, "ZAR")).toEqual({
      account: a.pool,
      balance: money("ZAR", 0),
    });
    expect((await ledger.trialBalance()).lines).toEqual([]);

    expectOk(await ledger.post(request));
    expect(await ledger.balance(a.pool, "ZAR")).toEqual({
      account: a.pool,
      balance: money("ZAR", 100_00),
    });
  });

  it("two posts racing to overdraw one guarded account: at most one is stored", async () => {
    const ledger = openLedger();
    for (let round = 0; round < 20; round++) {
      const a = accounts();
      expectOk(await ledger.configureAccount(a.member, { guarded: true }));
      expectOk(await ledger.post(contribution(a, 100_00)));

      const results = await Promise.all([
        ledger.post(refund(a, 100_00)),
        ledger.post(refund(a, 100_00)),
      ]);

      const stored = results.filter((result) => result.ok).length;
      expect(stored).toBe(1);
      for (const result of results) {
        if (!result.ok) expect(result.error.code).toBe("insufficient_funds");
      }
      expect((await ledger.balance(a.member, "ZAR")).balance.minor).toBe(0);
    }
  });

  it("posted transactions and their entries cannot be updated or deleted", async () => {
    const path = ledgerFile();
    const ledger = openLedger(path);
    const a = accounts();
    const request = contribution(a, 50_00);
    expectOk(await ledger.post(request));

    const side = new DatabaseSync(path);
    expect(() =>
      side.exec(
        `UPDATE transactions SET description = 'changed' WHERE idempotency_key = '${request.idempotencyKey}'`,
      ),
    ).toThrow(/never changed/);
    expect(() => side.exec("DELETE FROM transactions")).toThrow(/never deleted/);
    expect(() => side.exec("UPDATE entries SET minor = 1")).toThrow(/never changed/);
    expect(() => side.exec("DELETE FROM entries")).toThrow(/never deleted/);
    side.close();

    expect(await ledger.findByIdempotencyKey(request.idempotencyKey)).toBeDefined();
    expect(await ledger.balance(a.pool, "ZAR")).toEqual({
      account: a.pool,
      balance: money("ZAR", 50_00),
    });
  });
});

describe("demonstration chart of accounts", () => {
  it("configures the pool and the supplier payable as guarded and fees as unguarded", async () => {
    const ledger = openLedger();
    expectOk(await configureChart(ledger));

    expectErr(
      await ledger.post({
        idempotencyKey: randomEventId(),
        description: "pool overdraw",
        entries: [debit(FEES, 10), credit(POOL_BANK, 10)],
      }),
      "insufficient_funds",
    );
    expectOk(
      await ledger.post({
        idempotencyKey: randomEventId(),
        description: "fee taken from nothing",
        entries: [debit(FEES, 10), credit(SUPPLIER_PAYABLE, 10)],
      }),
    );
  });

  it("guards each member liability once it is configured", async () => {
    const ledger = openLedger();
    const memberId = HEX64;
    expectOk(await configureMemberAccount(ledger, memberId));
    const account = memberLiability(memberId);
    expectOk(
      await ledger.post({
        idempotencyKey: randomEventId(),
        description: "contribution",
        entries: [debit(POOL_BANK, 100_00), credit(account, 100_00)],
      }),
    );
    expectErr(
      await ledger.post({
        idempotencyKey: randomEventId(),
        description: "over-refund",
        entries: [debit(account, 100_01), credit(POOL_BANK, 100_01)],
      }),
      "insufficient_funds",
    );
  });

  it("accepts only opaque member ids: lowercase hex of 32 or more characters", async () => {
    const ledger = openLedger();
    expect(memberLiability(HEX64)).toBe(`liabilities:member/${HEX64}`);
    for (const refused of [
      "0821234567", // a phone number, digits only
      "8001015009087", // a 13-digit ID number
      "+27821234567",
      "ABCDEF".repeat(6), // upper case
      "Not A Slug",
    ]) {
      expect(() => memberLiability(refused)).toThrow(TypeError);
      expectErr(await configureMemberAccount(ledger, refused), "invalid_request");
    }
  });
});

describe("money arithmetic at the safe-integer limit", () => {
  const MAX = Number.MAX_SAFE_INTEGER;

  it("the reviewer's near-2^53 amounts are unbalanced, not accepted by rounding", async () => {
    const ledger = openLedger();
    const r = unique("n");
    const debits = [4, 9007199254740990, 7];
    const credits = [7, 4503599627370497, 4503599627370495];
    const entries: LedgerEntry[] = [
      ...debits.map((minor, i) => debit(`assets:bank/${r}d${String(i)}`, minor)),
      ...credits.map((minor, i) => credit(`liabilities:member/${r}c${String(i)}`, minor)),
    ];
    expectErr(
      await ledger.post({ idempotencyKey: randomEventId(), description: "near limit", entries }),
      "unbalanced",
    );
  });

  it("a balanced post at the limit is accepted, and the books stay readable", async () => {
    const ledger = openLedger();
    const r = unique("b");
    const pool = `assets:bank/${r}`;
    const member = `liabilities:member/${r}`;
    expectOk(
      await ledger.post({
        idempotencyKey: randomEventId(),
        description: "at the limit",
        entries: [debit(pool, MAX - 1), debit(pool, 1), credit(member, MAX)],
      }),
    );
    expect((await ledger.balance(pool, "ZAR")).balance.minor).toBe(MAX);
    expect((await ledger.trialBalance()).totals).toEqual([
      { currency: "ZAR", debits: MAX, credits: MAX },
    ]);
  });

  it("refuses a post that would push one account total past the limit", async () => {
    const ledger = openLedger();
    const r = unique("p");
    const pool = `assets:bank/${r}`;
    const member = `liabilities:member/${r}`;
    expectOk(
      await ledger.post({
        idempotencyKey: randomEventId(),
        description: "fill",
        entries: [debit(pool, MAX), credit(member, MAX)],
      }),
    );
    expectErr(
      await ledger.post({
        idempotencyKey: randomEventId(),
        description: "one more",
        entries: [debit(pool, 1), credit(member, 1)],
      }),
      "invalid_request",
    );
    expect((await ledger.balance(pool, "ZAR")).balance.minor).toBe(MAX);
    expect((await ledger.trialBalance()).totals).toEqual([
      { currency: "ZAR", debits: MAX, credits: MAX },
    ]);
  });

  it("two guarded accounts both overdrawn in one post: refused, nothing stored", async () => {
    const ledger = openLedger();
    const a = accounts();
    expectOk(await ledger.configureAccount(a.member, { guarded: true }));
    expectOk(await ledger.configureAccount(a.supplier, { guarded: true }));
    const request = {
      idempotencyKey: randomEventId(),
      description: "double overdraw",
      entries: [debit(a.member, 10), debit(a.supplier, 10), credit(a.fees, 20)],
    } satisfies PostRequest;
    expectErr(await ledger.post(request), "insufficient_funds");
    expect(await ledger.findByIdempotencyKey(request.idempotencyKey)).toBeUndefined();
    expect(await ledger.balance(a.member, "ZAR")).toEqual({
      account: a.member,
      balance: money("ZAR", 0),
    });
    expect(await ledger.balance(a.supplier, "ZAR")).toEqual({
      account: a.supplier,
      balance: money("ZAR", 0),
    });
  });
});

describe("idempotency keys are event ids", () => {
  it("refuses keys that are not 128 lowercase hex, including 'abc' and 'abc ' with a space", async () => {
    const ledger = openLedger();
    const a = accounts();
    const good = randomEventId();
    const entries = [debit(a.pool, 1), credit(a.member, 1)];
    for (const key of [
      "abc",
      "abc ",
      "",
      ` ${good}`,
      `${good} `,
      good.toUpperCase(),
      good.slice(1),
    ]) {
      expectErr(
        await ledger.post({ idempotencyKey: key, description: "key", entries }),
        "invalid_request",
      );
    }
    expect(await ledger.balance(a.pool, "ZAR")).toEqual({
      account: a.pool,
      balance: money("ZAR", 0),
    });
    expect((await ledger.trialBalance()).lines).toEqual([]);
  });
});

describe("guards cannot be switched off once an account has entries", () => {
  it("refuses to turn off a guard on an account with entries, and allows turning one on", async () => {
    const ledger = openLedger();
    const a = accounts();
    expectOk(await ledger.configureAccount(a.member, { guarded: true }));
    expectOk(await ledger.post(contribution(a, 100_00)));
    expectErr(await ledger.configureAccount(a.member, { guarded: false }), "invalid_request");
    expectErr(await refundFrom(ledger, a, 150_00), "insufficient_funds");

    // Turning a guard on is always allowed, even with entries.
    expectOk(await ledger.configureAccount(a.pool, { guarded: true }));
    // A fresh account with no entries may be unguarded.
    expectOk(await ledger.configureAccount(a.supplier, { guarded: false }));
  });

  it("the chart's pool and supplier payable cannot be unguarded once used", async () => {
    const ledger = openLedger();
    expectOk(await configureChart(ledger));
    expectOk(
      await ledger.post({
        idempotencyKey: randomEventId(),
        description: "pool funded",
        entries: [debit(POOL_BANK, 100), credit(FEES, 100)],
      }),
    );
    expectOk(
      await ledger.post({
        idempotencyKey: randomEventId(),
        description: "supplier owed",
        entries: [debit(FEES, 10), credit(SUPPLIER_PAYABLE, 10)],
      }),
    );
    expectErr(await ledger.configureAccount(POOL_BANK, { guarded: false }), "invalid_request");
    expectErr(
      await ledger.configureAccount(SUPPLIER_PAYABLE, { guarded: false }),
      "invalid_request",
    );
    expectOk(await configureChart(ledger));
  });
});

describe("malformed input", () => {
  it("post returns invalid_request, never throws, for malformed requests", async () => {
    const ledger = openLedger();
    const a = accounts();
    const key = randomEventId();
    const ok2 = [debit(a.pool, 1), credit(a.member, 1)];
    const malformed: unknown[] = [
      null,
      "a string",
      { idempotencyKey: key, description: "x", entries: "not an array" },
      { idempotencyKey: key, description: 5, entries: ok2 },
      { idempotencyKey: key, description: "x", entries: [null, null] },
      { idempotencyKey: key, description: "x", entries: [1, 2] },
      { idempotencyKey: key, description: "x", entries: ok2, metadata: { n: 1 } },
      { idempotencyKey: key, description: "x", entries: ok2, metadata: null },
    ];
    for (const request of malformed) {
      expectErr(await ledger.post(request as PostRequest), "invalid_request");
    }
    expect((await ledger.trialBalance()).lines).toEqual([]);
  });

  it("balance rejects a malformed slug or currency with a TypeError (the port returns no Result)", async () => {
    const ledger = openLedger();
    await expect(ledger.balance("Not A Slug", "ZAR")).rejects.toThrow(TypeError);
    await expect(ledger.balance("assets:bank/x", "zar")).rejects.toThrow(TypeError);
  });
});

describe("opening the file", () => {
  it("refuses a file that is not a database", () => {
    const path = ledgerFile();
    writeFileSync(path, "this is plain text, not a SQLite database\n".repeat(200));
    expect(() => openSqliteLedger({ path, clock })).toThrow();
  });
});
