# Decision D-2: the ledger is our own, self-hosted on the OCN Node (not Ledfra)

**Status:** accepted by the product owner on 2026-10-26. Closes open decision D-2.
**Epic:** 4 (pooled money). Affects stories 4.1 (dropped), 4.2 (re-described) and 1.6 (narrowed).

## Question

Accept the hosted Ledfra ledger (with its Early Access price lock before 2026-12-31 and its unverified self-hosting, tenancy, reversal and export terms), or require a ledger we host ourselves?

## Decision

**We build our own double-entry ledger, self-hosted on the OCN Node, behind the existing `Ledger` port.** Ledfra is no longer the default adapter. Entry 4.1 (Ledfra fit) is dropped because there is no vendor to test, and the 2026-12-31 deadline no longer applies.

## What the ledger must do (from the port and the Ledfra behaviours the plan relied on)

- Every event becomes one balanced transaction keyed by its event id; an unbalanced post is refused.
- Entries are immutable; a repeat post with the same idempotency key creates no second transaction and is recorded as a replay; a reused key with different content is a conflict.
- Member accounts are guarded: they cannot be overdrawn (a refund cannot take one below zero).
- Balances and a trial balance are derived on read.
- It passes the `Ledger` contract suite, as the in-memory adapter does.
- Every posting is mirrored as a record event so the ledger can be rebuilt from the record (AD-8).

## What changes

- Story 4.2 builds this ledger on the Node. It no longer waits on step 1.6, because it needs no outside account.
- Step 1.6 shrinks to the Stitch test client, the OSM extract and sample documents; the Ledfra workspace is dropped.
- The folder and epic names still say Ledfra and are left alone so ids and paths do not change.

## Risks

- We now own accounting-correctness code: it needs the contract suite, property tests (balance, idempotency, overdraw) and a review before real money moves.
- Persistence, backup and restore of the ledger become our job (epic 12).
- No vendor reports (P&L, balance sheet) for free; only what we build.

## Not decided here

Which store backs it (for example SQLite on the Node) and the chart of accounts; story 4.2's plan settles those.
