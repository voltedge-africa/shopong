---
title: 'Approve and pay a supplier from the pool'
type: 'feature'
ticket: 7
created: '2026-10-26'
status: draft
baseline_revision: '788a54d8ab1c5cedcf4ab94ed00f62779eefa091'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The pool must pay a supplier only when enough people with authority have approved that exact payment, and never pay twice or more than the pool holds. Today nothing at the OCN Node checks authority before money moves (S-2.5-9, S-2.5-15).

**Approach:** A signed Node route takes a payout request: the amount, the chosen supplier's quote and the approvals. The Node checks each approval with `verifyAuthority` at its own log time, with the amount as the ceiling. It counts distinct approvers against the rule, posts one balanced ledger entry (pool bank to supplier payable), then creates the payout through the `PayOut` port. The event id keys both. Stitch is simulated behind the port (story 4.3).

## Boundaries & Constraints

**Always:** Every approval is checked at the Node, never on the phone alone. Each approver confirms on their own device (amount, supplier, effect) before signing. The ledger posting happens before any money leaves. The event id is the idempotency key for the posting and the payout (AGENTS rules 4, 5, 8). Bank details stay on the Node. Amounts are whole cents.

**Never:** Paying from a phone. Paying without a fresh signed approval for this amount and this supplier. Writing bank details to the record. A partial payment. Refunds or partial funding (story 4.8). Confirming the payout's final state (story 4.5 reconciles it). Letting an agent start a payout.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Approved and funded | Enough approvals within limits; pool covers amount | One posting and one payout, both keyed by the event id; "Payment sent to <supplier>" | None |
| One approval only | Fewer approvals than the rule needs | Nothing posted or paid | "Two people must approve this payment." (wording per question 1) |
| Over the limit | Co-treasurer limit R1000, amount R1500 | Nothing posted or paid | "That is above your limit of R1000." |
| Role ended | Approver's role ended before the Node's log time | Approval not counted | "Your role ended on <date>." |
| Approval replayed | Same signed approval sent twice | Counted once; second request refused | "That request was already used." |
| Same person twice | One person approves twice | Counted once | None |
| Same event id again | Identical request re-sent | Returns the first result; no second posting or payout | None |
| Pool short | Pool R300.00, payment R500.00 | Nothing posted or paid | "The pool has R300.00; this payment needs R500.00. Nothing was paid." |
| No supplier chosen | No quote selected | Refused | "Choose a supplier first." |
| Node restarts mid-payment | Posting done, payout not created | Retry with the same key creates the payout once | Node's own idempotency table (see Code Map) |
| Payout refused by processor | Processor reports failed | Posting kept; payout shown as failed | Per question 8 |

## Code Map

- `packages/ports/src/payments.ts` -- `PayOut`, `PayoutInput`, `PayoutApproval` (approval evidence is required).
- `packages/adapters-memory/src/payments.ts` -- `MemoryPayOut` exists today; story 4.3 builds the simulated Stitch adapter behind the same port.
- `packages/ports-contract/src/payments.ts` -- the contract suite every adapter passes.
- `packages/ledger-sqlite/src/chart.ts` -- `POOL_BANK` (guarded), `SUPPLIER_PAYABLE` (guarded), `configureChart`.
- `packages/ledger-sqlite/src/ledger.ts` -- `post` returns `insufficient_funds` for a short pool.
- `packages/community/src/roles.ts` -- `ROLES` (`payment/approve`, limited), `checkAction`, `roleMessage`.
- `packages/community/src/authority.ts` -- `verifyAuthority`, the check run at the Node.
- `packages/community/src/quotes.ts` -- `quotesOf`, `isTreasurer`.
- `packages/community/src/request-proof.ts` -- `signRequest`, `verifyRequestSignature`.
- `packages/community/src/refusals.ts` -- refusal log shape.
- `packages/events/src/registry.ts` -- `payment.requested`, `payment.completed`, `payment.failed`, `order.approved` exist; no approval event type yet.
- `apps/node/src/authority.ts`, `apps/node/src/signed.ts` -- `createAuthorityGuard` (answers 503 until configured), `verifySignedRequest`, `SeenNonces`.
- `apps/node/src/config.ts`, `apps/node/src/components.ts`, `apps/node/src/secrets.ts` -- ledger and payments components are off by default and need secrets.
- `miniapps/vendor/orders/src/ranking.ts`, `miniapps/vendor/orders/src/Orders.tsx` -- `orderRanking` and the ranking card (supplier choice, story 6.9).
- `packages/community/src/rank.ts` -- `Recommendation` (`clear`, `too_close`, `only_one`, `none`).
- `apps/shopong/lib/community.ts` -- the service that sends the approval.
- `_bmad-output/initiative-ocn/shortcuts.md` -- S-2.5-9 (first caller), S-2.5-14 (signed approvals need a domain tag before a second signed type), S-2.5-15.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/community/src/payout.ts` (new) -- pure rule: count distinct approvals that pass `verifyAuthority` at the Node's time with the amount as ceiling; plain refusal reasons; tests per matrix row
- [ ] `apps/node/src/` -- configure the authority (S-2.5-15); signed `POST /payouts` that checks approvals, posts the ledger entry keyed by the event id, creates the payout through `PayOut` with the approval evidence, and keeps its own idempotency table; tests on the in-memory ledger and `MemoryPayOut`
- [ ] Record -- approval and payout events per question 3, with registry entries and tests; the per-community `approvals` setting in the founding event (see the change of answer under Open Questions), its validation in `apply` and its default of two
- [ ] `apps/shopong/` -- confirmation step naming amount, supplier and effect; signs only after confirmation; supplier choice from the ranking; shows refusal reasons
- [ ] `_bmad-output/initiative-ocn/shortcuts.md` -- close S-2.5-9 and S-2.5-15; domain-tag the approval signature (S-2.5-14); add a row for each shortcut taken

**Acceptance Criteria:**
- Given a funded pool and enough approvals within their ceilings, when the payout is requested, then the Node posts one balanced entry and creates one payout, both keyed by the event id.
- Given a missing approval or an approval above its ceiling, then nothing is posted or paid and the plain reason shows.
- Given the same request twice, then one posting and one payout exist.
- Given a pool short of the amount, then nothing is posted or paid and the shortfall shows.
- Given `pnpm run ci`, then it passes.

## Verification

**Commands:**
- `pnpm run test` -- expected: all pass, including the payout rule and the Node route
- `pnpm run ci` -- expected: passes

**Manual (both, every time):**
- Web: run `apps/shopong` in the browser with a seeded pool and two approver identities; run each matrix row and screenshot each refusal and the success.
- Android emulator: the same rows on Expo Go; check the confirmation step fits the screen.
- Payments are simulated: no real Stitch call is made, and the screen says so.

## Open Questions

**Change of answer, 2026-10-26 (product owner): question 1 is option C, not A.** The number of approvals a supplier payment needs is a per-community setting chosen when the community is created, with a default of two distinct people (the creator counts as one, each within their own limit). Consequences for this story:
- **Where the setting lives:** a new field in the founding event of the community (for example `approvals`, an integer from 1 to 5), written once at creation, readable in the view, and not changeable in this story (changing it is later work). A community created without the field gets the default of two.
- **Validation:** `apply` refuses a founding event whose value is missing-but-present-as-text, below 1 or above 5, or not a whole number; the payout rule reads the number from the view, never from the request.
- **What a person sees:** when creating a community, a plain choice "How many people must approve a payment to a supplier?" with 1, 2 (suggested), 3, 4 or 5; one approver is allowed but the screen says plainly that one person can then pay out alone. The confirmation screen says "This payment needs N approvals. You are approval K of N."
- **Safety rules that do not change:** each approver still confirms on their own phone, the rand limit is still checked at the Node for each approver, a creator counts as one approver only once, and the same person cannot approve twice.
- **Extra work:** one more field in the community creation screen (Settings card, web and emulator checked), the founding-event schema and tests, and tests for every N from 1 to 5 and for the default. Record the 'one approver means one person can pay out alone' risk as a shortcut row.

**Answered 2026-10-26 by the product owner: all recommended answers accepted (first option of every question). Testing rule: any story that changes the app is checked on web AND the Android emulator, every time; any older wording that says the emulator is checked only when asked is out of date. Stitch is simulated until the product owner has the Stitch account; the simulation is labelled everywhere and recorded as shortcuts.**

1. **How many approvals?** The brief names who may approve; the epic says "the required number".
   - A) Two distinct people, each within their own limit; the creator counts as one. (Recommended: nobody pays out alone.)
   - B) One approver: the treasurer, or a co-treasurer within their limit. (Literal reading of the brief.)
   - C) A number set per community at creation, default two.
2. **What is the human confirmation step?**
   - A) Each approver confirms on their own phone (amount, supplier, effect); the signed approval is that confirmation, and the Node refuses a payout without fresh ones. (Recommended.)
   - B) The treasurer confirms once; the others approve without a second look.
   - C) A, plus the device PIN from `apps/shopong/lib/pin.ts` before signing.
3. **Where are approvals recorded?**
   - A) A new `payment.approved` event type, one per approver, carrying the payout's event id. (Recommended: a new type, not a second envelope.)
   - B) Reuse `order.approved`.
   - C) Only in the payout event's payload, with all approver ids.
4. **What does the ledger posting look like?**
   - A) One entry per payout: debit the pool bank, credit the supplier payable; post first, then pay, so a short pool stops before money moves. The payable stays open in this story. (Recommended.)
   - B) Add a clearing entry when the payout completes; needs a new account in the chart.
   - C) One payable account per supplier; needs a chart change.
5. **Where do supplier bank details come from?**
   - A) Typed by the treasurer into the Node's own store, keyed by supplier id; never in the record. (Recommended: AGENTS rule 4 and `PayoutBeneficiary`.)
   - B) The supplier enters them on their own phone, sent to the Node.
   - C) Stored in the record, encrypted. Rejected by default because the record replicates to every member.
6. **How is the supplier chosen?**
   - A) Pay the supplier named by a `clear` ranking. For `too_close`, `none` or `only_one`, the treasurer picks a quote, the approval names it, and the ranking shown is recorded. (Recommended.)
   - B) The treasurer always picks; the ranking is advice only.
   - C) Refuse payment unless the ranking is `clear`.
7. **What happens when funds are short?**
   - A) Refuse with both amounts; nothing is posted or paid; partial funding is story 4.8. (Recommended.)
   - B) Hold the request in a queue until the pool is funded.
   - C) Pay what the pool has.
8. **What if the processor refuses the payout after the posting?**
   - A) Keep the posting, show the payout as failed, and let the reconciler (4.5) and story 4.8 settle it. (Recommended: no reversal logic here.)
   - B) Post a compensating entry automatically in this story.
9. **Verification scope.** The brief asks for web and Android emulator every time; the stored preference is the emulator only when asked.
   - A) Both, as the brief says. (Recommended.)
   - B) Web only, with the emulator on request.
10. **Could not verify:** whether `POST /payouts` can reuse `createCommunityService` for the approvals, and whether the Node's own idempotency table needs its own storage (Stitch does not document `externalReference` uniqueness). Both need a check before tasks start.
