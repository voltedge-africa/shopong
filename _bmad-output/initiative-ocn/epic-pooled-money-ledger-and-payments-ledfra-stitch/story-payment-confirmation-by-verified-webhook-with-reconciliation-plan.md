---
title: "Payment confirmation by verified webhook, with reconciliation"
ticket: 5
status: draft
baseline_revision: "788a54d8ab1c5cedcf4ab94ed00f62779eefa091"
---

# Payment confirmation by verified webhook, with reconciliation

## Intent

**Problem:** Story 4.3 creates payment requests and a simulated payment (Stitch is postponed, 2026-10-26). Nothing yet confirms a payment, so a member's money can sit in "waiting" forever, and the books, the shared record and the payment provider can drift apart unseen.

**Approach:** The Node accepts a webhook at `/webhooks/stitch` and verifies its signature on the raw body. The event id is the idempotency key. A confirmed payment is written in this order: our ledger, then `payment.completed` or `payment.failed` in the shared record through the replica hub, then the 2xx acknowledgement. A periodic reconciler compares record, ledger and provider and flags every mismatch to the treasurer. Simulated and real webhooks use the same route and verifier.

## Boundaries & Constraints

**Always:** The webhook key lives only on the Node (AGENTS rule 4). Verification runs on the raw body before any parse. Every write is keyed by the event id (rule 5). Posted ledger transactions are never changed. A mismatch is shown, never silently repaired.

**Never:** A device or the web console holds a payment secret or the webhook key. Redirect parameters confirm nothing. A webhook for an unknown request posts nothing. Refunds, reversals and shortfalls (story 4.8). Real Stitch calls, or a real signature scheme before spike 4.4 verifies it. Copying the memory adapter's `fakeDigest` as a signature.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Verified completion | Signed `completed` for a pending request | Ledger posted once, `payment.completed` recorded, 2xx | None |
| Duplicate webhook | Same delivery twice | One ledger post, one record event, 2xx both times | Second returns `applied: false` |
| Out-of-order webhook | A later status arrives before an earlier one | Only the terminal state counts | None |
| Unsigned or wrongly signed | Missing or bad signature | Nothing written | `invalid_signature`, 401, body not logged |
| Unknown request | Valid signature, reference not known | Nothing posted | `unknown_payment`, flagged to treasurer, 2xx |
| Amount mismatch | Webhook amount differs from the request | Nothing posted | Flagged for treasurer, not confirmed |
| Confirmed after failed | `completed` for a payment already `failed` | Not posted, status not changed | Flagged as a conflict |
| Ledger post fails | Ledger write fails before the record write | Nothing recorded, not acknowledged | Provider retries; reconciler flags if it stays failed |
| Node restarts mid-way | Crash after ledger, before record or ack | Retry replays the ledger (`replayed: true`), then writes the record | Reconciler runs once at start |

## Code Map

Verified to exist:
- `packages/ports/src/payments.ts` -- `PayIn.ingestWebhook`, `WebhookDelivery`, `PaymentStatus` (read only).
- `packages/ports/src/ledger.ts` -- `post`, `findByIdempotencyKey`, `PostRequest` (read only).
- `packages/ports-contract/src/payments.ts` -- webhook cases: replay, bad signature.
- `packages/adapters-memory/src/payments.ts` -- simulated processor; its `fakeDigest` is not HMAC and must not be copied.
- `packages/adapters-memory/src/test-hmac.ts` -- test-only HMAC-SHA512; production injects an audited one.
- `packages/ledger-sqlite/src/ledger.ts`, `src/chart.ts` -- `POOL_BANK`, `SUPPLIER_PAYABLE`, `FEES`, `memberLiability`.
- `apps/node/src/signed.ts` -- request gate and raw-body pattern.
- `apps/node/src/hub.ts` -- `ReplicaHub` (`recordOf`, `acknowledge`).
- `apps/node/src/sync.ts` -- append route pattern (`POST /spaces/:key/events`).
- `apps/node/src/node.ts` -- `startNode`, `closeInOrder`.
- `apps/node/src/secrets.ts` -- `SECRET_DEFINITIONS`; `STITCH_CLIENT_*` owned by `payments`; no webhook key yet.
- `apps/node/src/record.ts` -- `nodeDid`.
- `packages/events/src/envelope.ts` -- `EventEnvelope`.
- `docs/sandbox-setup.md` -- section 1, steps 7 and 8 (webhook path; signing method unknown).

Not found, to be created: a webhook route in `apps/node`, any `payment.completed` event type, a reconciler.

## Tasks & Acceptance

**Execution:**
- [ ] `apps/node/src/stitch-webhook.ts` -- route, raw-body verifier, the three writes in order.
- [ ] `apps/node/src/reconciler.ts` -- periodic comparison of record, ledger and provider; returns a mismatch list.
- [ ] `apps/node/src/secrets.ts` -- one webhook secret, owner `payments`, placeholder in `.env.example`.
- [ ] Tests for each matrix row; `shortcuts.md` rows for each shortcut.

**Acceptance Criteria:**
- Given a verified completion delivered twice, then the ledger holds one transaction and the record one `payment.completed`.
- Given a bad or missing signature, then nothing is written and the response is 401.
- Given a crash after the ledger post, when the Node restarts and the webhook is redelivered, then exactly one record event exists.
- Given a record and ledger that disagree, when the reconciler runs, then the mismatch is listed and nothing changes.

## Verification

- `pnpm run ci`, and `vp test` for the new route and reconciler.
- The ledger contract and matrix rows run against the memory and SQLite adapters.
- Reconciler test with a deliberately missing record event; asserts a flagged mismatch.
- **Not verified:** the real Stitch signature and payload (spike 4.4); whether the replica hub can append as the Node's own DID (no code path for it found); whether the record deduplicates by event id.

## Open Questions

**Answered 2026-10-26 by the product owner: all recommended answers accepted (first option of every question). Testing rule: any story that changes the app is checked on web AND the Android emulator, every time; any older wording that says the emulator is checked only when asked is out of date. Stitch is simulated until the product owner has the Stitch account; the simulation is labelled everywhere and recorded as shortcuts.**

1. **Order of the three writes.**
   - A. Ledger, then record, then acknowledgement (recommended). The ledger is the money record and is idempotent by key; a crash after it is repaired by redelivery, and the reconciler catches the rest.
   - B. Record, then ledger, then acknowledgement. Puts "completed" in the record before the money is posted.
   - C. Acknowledge first, then write both. A crash loses the retry that would repair them.

2. **Webhook idempotency key.**
   - A. Event id: SHA-512 of the canonical `payment.completed` event built from the external reference, amount and status (recommended). Matches rule 5.
   - B. Stitch's own delivery id, if it has one. Unverified.
   - C. Payment id alone. Cannot tell a repeat from a new status.

3. **Simulated and real signature.**
   - A. HMAC-SHA512 over the raw body with a dedicated `STITCH_WEBHOOK_SECRET` held only on the Node (recommended). Simulator and real verifier share one path; only the scheme changes after spike 4.4.
   - B. Reuse `STITCH_CLIENT_SECRET`. Couples two credentials.
   - C. Copy the memory adapter's `fakeDigest`. Not a signature.

4. **Webhook for an unknown request.**
   - A. Verify, post nothing, record an unmatched item for the treasurer, return 2xx (recommended). Stops endless retries and keeps the item visible.
   - B. Return 404 so the provider retries. Retries never resolve it.
   - C. Drop silently. Hides money that arrived.

5. **Reconciliation schedule.**
   - A. Every 15 minutes, once at Node start, plus a provider poll for any pending request older than 30 minutes (recommended).
   - B. Hourly. A stuck payment can sit unseen for an hour.
   - C. Daily. Too slow to act on.

6. **What a mismatch looks like to a treasurer.**
   - A. A "Needs checking" list in plain words, for example: "Thandi's R500 shows as paid by the bank but is not in the pool books. Nothing has changed. Ask the admin to check." Nothing is repaired automatically (recommended).
   - B. Automatic repair of the missing side. Hides what went wrong.
   - C. A log line only. The treasurer never sees it.

7. **Completion after failed.**
   - A. Do not post; flag as a conflict for the treasurer (recommended). The port says terminal states never change.
   - B. Post and set completed. Breaks the terminal-state rule.
   - C. Ignore. May lose money that arrived.

8. **Who signs the record event.**
   - A. The Node's own DID from `nodeDid` (recommended). Matches rule 4 and AD-3.
   - B. A treasurer's DID. Makes a person appear to have confirmed money the Node confirmed.

Refunds, reversals and shortfalls are left to story 4.8. The ledger plan's Never row names story 4.6 for refunds; reconcile that with the epic.

## Review Triage Log

Pass 1 (one Haiku read-only reviewer, 2026-10-26). 1 high, 5 medium, 5 low. The orchestrator also ran a real Node with the SQLite ledger and simulated payments, and checked the pool card on web and the Android emulator.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | Nothing in the pool figures a member sees said "simulated" | high, real | patch | The pool answer carries `simulated: true` and a plain sentence, shown first on the pool card; mutation-checked on the Node and the phone; seen on web and emulator |
| 2, 3, 4 | Races: a completed and a failed webhook together, a cancel or expiry between the check and the posting, and a failure written to the record before the provider status | medium, real | patch | A per-payment lock covers check, books, record and provider; the status is re-read inside it and before posting; the provider status is applied first; anything unpreventable is flagged at write time; tests with an interleaving; mutation-checked |
| 5 | The Node's own SQLite books demanded a `LEDFRA_API_TOKEN` | medium, real | patch | Removed (Ledfra was dropped, AD-22); a Node with the ledger enabled and no token starts and opens `ledger.sqlite` (seen for real); S-4.5-9 closed |
| 6 | The 503 text said "Nothing was applied" when money had moved | medium, real | patch | True state in the message and distinct codes (`books_written`, `record_written`, `status_written`, `state_unwritten`) |
| 7, 8, 9, 10 | A corrupt flags file stopped the Node; the flags file write was not fully checked; refusal texts lacked "simulated"; the route revealed which communities the Node holds | low, real | patch | Set aside and logged; every byte checked and the directory synced; wording; one answer for unknown community and stranger |
| 11 | The record's `apply` accepts `payment.*` from any admitted writer | low | defer | S-4.5-20 (the Node's reads require the creator's replica and the Node identity) |
| gaps | (mutation check) a failing record write had no test; failure with no pledge; out-of-order webhook | real | patch | Tests added; mutation-checked |

