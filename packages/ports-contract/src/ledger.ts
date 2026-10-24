import { expect } from "vite-plus/test";
import { money, type Ledger, type LedgerEntry, type PostRequest } from "@shopong/ports";
import {
  expectErr,
  expectOk,
  randomEventId,
  registerContract,
  unique,
  type ContractCase,
  type ContractOptions,
  type Factory,
} from "./support.js";

/** Account slugs unique to one test, so a persistent sandbox ledger starts each test at zero. */
function accounts() {
  const run = unique("t");
  return {
    pool: `assets:bank/${run}`,
    member: `liabilities:member/${run}`,
    supplier: `liabilities:supplier/${run}`,
    fees: `income:fees/${run}`,
  };
}

const debit = (account: string, minor: number, currency = "ZAR"): LedgerEntry => ({
  account,
  direction: "debit",
  amount: money(currency, minor),
});
const credit = (account: string, minor: number, currency = "ZAR"): LedgerEntry => ({
  account,
  direction: "credit",
  amount: money(currency, minor),
});

function contribution(
  a: ReturnType<typeof accounts>,
  minor: number,
  key: string = randomEventId(),
): PostRequest {
  return {
    idempotencyKey: key,
    description: "member contribution",
    metadata: { eventSha512: key },
    entries: [debit(a.pool, minor), credit(a.member, minor)],
  };
}

async function balanceOf(ledger: Ledger, account: string): Promise<number> {
  return (await ledger.balance(account, "ZAR")).balance.minor;
}

export const ledgerContract: readonly ContractCase<Ledger>[] = [
  {
    name: "posts a balanced transaction and moves balances in each account's normal direction",
    run: async (ledger) => {
      const a = accounts();
      const request = contribution(a, 250_00);
      const receipt = expectOk(await ledger.post(request));
      expect(receipt.replayed).toBe(false);
      expect(receipt.transaction).toMatchObject({
        idempotencyKey: request.idempotencyKey,
        description: "member contribution",
        metadata: { eventSha512: request.idempotencyKey },
      });
      expect(receipt.transaction.id).toEqual(expect.any(String));
      expect(receipt.transaction.entries).toEqual(request.entries);
      expect(await ledger.balance(a.pool, "ZAR")).toEqual({
        account: a.pool,
        balance: money("ZAR", 250_00),
      });
      expect(await balanceOf(ledger, a.member)).toBe(250_00);
    },
  },
  {
    name: "posts a multi-entry transaction",
    run: async (ledger) => {
      const a = accounts();
      expectOk(await ledger.post(contribution(a, 1000_00)));
      expectOk(
        await ledger.post({
          idempotencyKey: randomEventId(),
          description: "pay supplier with fee",
          entries: [debit(a.member, 1000_00), credit(a.supplier, 950_00), credit(a.fees, 50_00)],
        }),
      );
      expect(await balanceOf(ledger, a.member)).toBe(0);
      expect(await balanceOf(ledger, a.supplier)).toBe(950_00);
      expect(await balanceOf(ledger, a.fees)).toBe(50_00);
    },
  },
  {
    name: "rejects an unbalanced transaction and changes nothing",
    run: async (ledger) => {
      const a = accounts();
      expectErr(
        await ledger.post({
          idempotencyKey: randomEventId(),
          description: "bad",
          entries: [debit(a.pool, 100), credit(a.member, 99)],
        }),
        "unbalanced",
      );
      expect(await balanceOf(ledger, a.pool)).toBe(0);
      expect(await balanceOf(ledger, a.member)).toBe(0);
    },
  },
  {
    name: "requires balance per currency",
    run: async (ledger) => {
      const a = accounts();
      expectErr(
        await ledger.post({
          idempotencyKey: randomEventId(),
          description: "mixed",
          entries: [debit(a.pool, 100, "ZAR"), credit(a.member, 100, "USD")],
        }),
        "unbalanced",
      );
    },
  },
  {
    name: "rejects malformed requests",
    run: async (ledger) => {
      const a = accounts();
      const post = (entries: LedgerEntry[]) =>
        ledger.post({ idempotencyKey: randomEventId(), description: "bad", entries });
      expectErr(await post([debit(a.pool, 100)]), "invalid_request");
      expectErr(await post([debit(a.pool, 0), credit(a.member, 0)]), "invalid_request");
      expectErr(
        await post([
          { account: a.pool, direction: "debit", amount: { currency: "ZAR", minor: -100 } },
          { account: a.member, direction: "credit", amount: { currency: "ZAR", minor: -100 } },
        ]),
        "invalid_request",
      );
      expectErr(
        await post([
          { account: a.pool, direction: "debit", amount: { currency: "ZAR", minor: 1.5 } },
          { account: a.member, direction: "credit", amount: { currency: "ZAR", minor: 1.5 } },
        ]),
        "invalid_request",
      );
      expectErr(await post([debit("cash:pool", 100), credit(a.member, 100)]), "invalid_request");
    },
  },
  {
    name: "the same key and body is a replay, not a second transaction",
    run: async (ledger) => {
      const a = accounts();
      const request = contribution(a, 100_00);
      const first = expectOk(await ledger.post(request));
      const second = expectOk(await ledger.post({ ...request, entries: [...request.entries] }));
      expect(second.replayed).toBe(true);
      expect(second.transaction.id).toBe(first.transaction.id);
      expect(await balanceOf(ledger, a.pool)).toBe(100_00);
    },
  },
  {
    name: "the same key with a different body is a conflict",
    run: async (ledger) => {
      const a = accounts();
      const request = contribution(a, 100_00);
      expectOk(await ledger.post(request));
      expectErr(
        await ledger.post(contribution(a, 200_00, request.idempotencyKey)),
        "idempotency_conflict",
      );
      expect(await balanceOf(ledger, a.pool)).toBe(100_00);
    },
  },
  {
    name: "a guarded account cannot go below zero; an unguarded one can",
    run: async (ledger) => {
      const a = accounts();
      expectOk(await ledger.configureAccount(a.member, { guarded: true }));
      expectOk(await ledger.post(contribution(a, 100_00)));
      const refund = (minor: number) =>
        ledger.post({
          idempotencyKey: randomEventId(),
          description: "refund",
          entries: [debit(a.member, minor), credit(a.pool, minor)],
        });
      expectErr(await refund(150_00), "insufficient_funds");
      expect(await balanceOf(ledger, a.member)).toBe(100_00);
      expectOk(await refund(100_00));
      expect(await balanceOf(ledger, a.member)).toBe(0);
      expectOk(
        await ledger.post({
          idempotencyKey: randomEventId(),
          description: "overdraw",
          entries: [debit(a.supplier, 10), credit(a.pool, 10)],
        }),
      );
      expect(await balanceOf(ledger, a.supplier)).toBe(-10);
    },
  },
  {
    name: "rejects configuring a malformed account slug",
    run: async (ledger) => {
      expectErr(await ledger.configureAccount("Not A Slug", { guarded: true }), "invalid_request");
    },
  },
  {
    name: "finds a transaction by idempotency key for reconciliation",
    run: async (ledger) => {
      const a = accounts();
      const request = contribution(a, 100_00);
      const { transaction } = expectOk(await ledger.post(request));
      expect(await ledger.findByIdempotencyKey(request.idempotencyKey)).toEqual(transaction);
      expect(await ledger.findByIdempotencyKey(randomEventId())).toBeUndefined();
    },
  },
  {
    name: "an account never referenced has a zero balance",
    run: async (ledger) => {
      const a = accounts();
      expect(await ledger.balance(a.fees, "ZAR")).toEqual({
        account: a.fees,
        balance: money("ZAR", 0),
      });
    },
  },
  {
    name: "the trial balance has equal debits and credits and includes every posting",
    run: async (ledger) => {
      const a = accounts();
      expectOk(await ledger.post(contribution(a, 300_00)));
      expectOk(await ledger.post(contribution(a, 200_00)));
      const trial = await ledger.trialBalance();
      for (const total of trial.totals) expect(total.debits).toBe(total.credits);
      expect(trial.lines).toContainEqual({
        account: a.pool,
        currency: "ZAR",
        debits: 500_00,
        credits: 0,
      });
      expect(trial.lines).toContainEqual({
        account: a.member,
        currency: "ZAR",
        debits: 0,
        credits: 500_00,
      });
    },
  },
];

/** Register the `Ledger` contract against an adapter. */
export function runLedgerContract(factory: Factory<Ledger>, options?: ContractOptions): void {
  registerContract("Ledger contract", ledgerContract, factory, options);
}
