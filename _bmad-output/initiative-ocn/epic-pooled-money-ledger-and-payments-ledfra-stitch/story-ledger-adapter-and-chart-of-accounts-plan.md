---
title: 'Ledger adapter and chart of accounts'
type: 'feature'
ticket: 2
created: '2026-10-26'
status: 'draft'
baseline_revision: 'bc9526b'
route: 'full'
route_source: 'auto'
risk: 'high'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Money in Demonstration 1 (members' payments, the pool, the supplier's payment) needs real books that survive a restart. Only an in-memory ledger exists. Decision D-2 (AD-22) made the ledger our own, on the OCN Node.

**Approach:** A new package, `@shopong/ledger-sqlite`, implements the existing `Ledger` port on a SQLite file on the Node, using the SQLite built into Node 24 (no new dependency). A fixed chart of accounts (module with the account names and which are guarded) is added beside it. The adapter passes the unchanged `Ledger` contract suite, like the in-memory one.

## Boundaries & Constraints

**Always:** The `Ledger` port is not changed. A post is atomic (all entries or none). The idempotency key is the event id (rule 5). Posted transactions are never updated or deleted. Amounts are whole minor units (integers). Time comes from an injected clock. No secrets, no personal details (opaque ids only). The data file path comes from the Node's config.

**Never:** Writing posts into the community record (story 4.7 mirrors them). Payments, Stitch or webhooks. Any use of Ledfra. Reversal or refund logic (story 4.6, which only uses what the port already allows). Running on a phone.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Balanced post | Debit 100, credit 100, new key | One transaction stored | None |
| Replay | Same key, same body | The first transaction, `replayed: true`, no second row | None |
| Conflict | Same key, different body | Refused | `idempotency_conflict` |
| Unbalanced | Debits differ from credits | Nothing stored | `unbalanced` |
| Overdraw | A post that takes a guarded account below zero | Nothing stored, balances unchanged | `insufficient_funds` |
| Restart | Close and reopen the file | Balances, trial balance and keys unchanged | None |
| Half a post | A failure in the middle of a post | No partial transaction | The error is returned, nothing stored |
| Two posts at once | Two overdrawing posts to one guarded account together | At most one succeeds | The other is `insufficient_funds` |

</frozen-after-approval>

## Code Map

- `packages/ports/src/ledger.ts` -- the port (read only).
- `packages/ports-contract/src/ledger.ts` -- the contract suite the adapter must pass (read only).
- `packages/adapters-memory/src/ledger.ts` -- the in-memory adapter, for style and behaviour to match.
- `packages/ledger-sqlite/` -- new package.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/ledger-sqlite/` -- new package `@shopong/ledger-sqlite` with `build` and `check-types`, extending `tsconfig.base.json`
- [ ] `src/chart.ts` -- the fixed chart of accounts for Demonstration 1 (pool bank, member liability per member, supplier payable, fees) and which are guarded, with a function that configures them
- [ ] `src/ledger.ts` -- the adapter on `node:sqlite`, one database transaction per post, a unique index on the key, balances derived on read
- [ ] `src/ledger.test.ts` -- runs the contract suite, then the I/O matrix rows the suite does not cover (restart, atomicity, concurrent overdraw)
- [ ] `_bmad-output/initiative-ocn/shortcuts.md` -- a row for each shortcut taken

**Acceptance Criteria:**
- Given the adapter, when the `Ledger` contract suite runs against it, then every case passes.
- Given a posted transaction, when the file is closed and reopened, then the transaction, its key and the balances are unchanged.
- Given two posts racing to overdraw one guarded account, when both run, then at most one is stored.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Design Notes

SQLite from Node 24 keeps the Node dependency-free and gives atomic writes for free. Balances are derived by summing entries, not stored, so they cannot drift from the entries.

## Open Questions

**Answered 2026-10-26 by the product owner: all recommended answers accepted.**

1. **Where do the books live?** A) SQLite from Node 24 (recommended: no new dependency, one file, atomic). B) The record only (slower, ties money to the record).
2. **Chart of accounts.** A) Fixed in code for Demonstration 1 (recommended). B) Defined per community in the record (later).
3. **Reversals.** A) Left to story 4.6 using new posts, never edits (recommended).

## Verification

**Commands:**
- `pnpm exec vp test run packages/ledger-sqlite` -- expected: all pass
- `pnpm run ci` -- expected: passes
