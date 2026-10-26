---
title: "Approve and pay the supplier"
type: "integration"
ticket: 5
created: "2026-10-26"
status: draft
baseline_revision: "5471d90"
risk: "high"
hitl: false
depends_on: ["4.7 (PR #53, not merged)", "8.4"]
---

### Intent

**Problem:** The pool may pay the supplier only when the required number of people have approved that exact payment, and every member must then see "Supplier paid" with the ledger and the record in agreement. Story 4.7 builds the approval and the payout on the Node. The demonstration needs that action from the Orders screen, the supplier chosen in 8.3, and the outcome shown to every member.

**Approach:** Compose 4.7 (once merged) into the demonstration flow. A treasurer chooses the supplier from the ranking, sends the payment for approval, each approver confirms on their own phone, and the Node posts the ledger entry and creates the simulated payout. The record gets the payout event, and every member's view shows "Supplier paid". Add only what is missing: the supplier-paid state in the member views, and a check that the ledger and the record agree after the payout.

### Boundaries & Constraints

**Always:** Each approval is checked by the Node at its own clock with `verifyAuthority` (4.7 plan). The ledger posting happens before the payout. The event id keys the posting and the payout (AGENTS rule 5). Supplier bank details live on the Node only (`POST /suppliers/bank` in 4.7's `apps/node/src/payouts.ts`), never in the record. Payments are simulated and labelled.

**Never:** Paying from a phone. A payout without fresh approvals for this amount and supplier. A partial payment. Refund or shortfall handling (4.8). Confirming the payout's final state beyond what the record shows (see question 3).

### I/O & Edge-Case Matrix

Use the 4.7 plan's matrix as written in `_bmad-output/initiative-ocn/epic-pooled-money-ledger-and-payments-ledfra-stitch/story-approve-and-pay-a-supplier-from-the-pool-plan.md` (on PR #53). Add these rows for the demonstration:

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Funded and approved | Pool at or above the order total; two approvals (the treasurer and a co-treasurer) | One posting, one payout, "Supplier paid" on every member's view | None |
| Pool not yet funded | 8.4 not finished | Payment button not offered; "The pool has R…; this payment needs R…. Nothing was paid." | Node refusal shown |
| Ledger off | `OCN_NODE_LEDGER_ENABLED` not set | Pool answers 503 "The books can't be read right now." | Shown as in 4.6; the demo must not start with this |
| Supplier paid shown to a member | Payout event in the record | Every member sees "Supplier paid" with the amount and the simulated label | None |
| Ledger and record disagree | Posting exists, payout event missing (or the reverse) | Flagged to the treasurer as an item to look at; nothing is re-paid | Question 3 |

### Code Map

- `packages/community/src/payout.ts` -- `APPROVALS_KEY` (`settings/approvals`), `DEFAULT_APPROVALS` (2), `APPROVAL_TAG` (`ocn-approval/v1`), `PAYOUT_TYPE` (`payment.payout`), `APPROVAL_TYPE` (`payment.approved`). **On PR #53 only.**
- `apps/node/src/payouts.ts` -- `registerPayoutRoutes`, `POST /payouts`, `POST /suppliers/bank`, `GET /suppliers/bank/commitment`, `createMemoryPayoutStore`, `openPayoutStore`. **On PR #53 only.**
- `miniapps/vendor/orders/src/PayoutsSection.tsx`, `miniapps/vendor/orders/src/payouts.ts` -- the treasurer's pay section and the approval prompt. **On PR #53 only.** `Orders.tsx` mounts it (line 122 on the branch).
- `packages/events/src/registry.ts` -- `payment.payout` and `payment.approved` are added by PR #53 (lines 24-25 on the branch). `order.closed` and `pool` are on main.
- `packages/scenario-stokvel/src/steps.ts` -- steps `pay-supplier` (about line 435) and `pool-funded`. Use as the expected output.
- `packages/community/src/pool.ts`, `apps/node/src/pool-read.ts` -- pool figures (4.6). Exists on main.
- `apps/node/src/reconciler.ts` -- pay-in reconciliation (4.5). Exists; does not cover payouts.
- `_bmad-output/initiative-ocn/shortcuts.md` -- S-2.5-9, S-2.5-14, S-2.5-15 (closed by 4.7); the 4.7 branch adds S-4.7-1 to S-4.7-23 (read them on the PR before the story starts).

### Tasks & Acceptance

**Execution:**
- [ ] Wait for PR #53 to merge; do not start tasks on the branch. If it is still open, stop and say so in the PR.
- [ ] Add a "Supplier paid" state to the member view, derived from the record's payout event (the view, not the phone's guess). Test on two replicas.
- [ ] Show the payout in the Orders screen for the treasurer (approval steps) and in the pool card for everyone (supplier paid, with the amount and the simulated label).
- [ ] Ledger and record check: a test that, after a payout, the posting's amount equals the payout's amount and both carry the event id.
- [ ] Demo setup: a demonstration pool with two approvers (creator and one co-treasurer with a limit at least the order total). The community settings value is set in the founding event (`settings/approvals`).
- [ ] `_bmad-output/initiative-ocn/shortcuts.md` -- record the simulated payout as a shortcut; list the S-4.7 rows this story retires.

**Acceptance Criteria:**
- Given a funded pool and two approvals within their limits, when the treasurer sends the payment, then the Node posts one entry and creates one simulated payout, and every member sees "Supplier paid".
- Given the same request twice, then one posting and one payout exist.
- Given a short pool or one approval, then nothing is posted or paid and the plain reason shows.
- Given `pnpm run ci`, then it passes.

### Shortcuts

- **Retire on this story:** S-2.5-9 and S-2.5-15 (per the 4.7 plan), once 4.7 has merged.
- **Keep:** the simulated payout (no real Stitch call); bank details on the Node store, typed by the treasurer (question 4); the one-approver risk if the setting is set to 1.
- **Add:** a row for the demo's fixed two-approver setting, and one for the simulated payout's processor result.

### Verification

**Commands:** `pnpm run test`, `pnpm run ci`.

**Manual, both every time:**
- Web: seeded funded pool, two approver identities. Run the refusal rows and the success row, and screenshot each. Confirm "Supplier paid" on a second member's view.
- Android emulator: the same rows on Expo Go. Check the confirmation step fits the screen. Note what was not checked.

### Open Questions

**Answered 2026-10-26 by the product owner: all recommended answers accepted.**


1. **Approvals for the demonstration.** The 4.7 plan's answer is a per-community setting, default 2.
   - A) Two approvers, the treasurer and a co-treasurer. (Recommended: nobody pays alone; matches the 4.7 default.)
   - B) One approver, the treasurer alone. (Literal reading of the brief; the screen must say that one person can then pay out alone.)
2. **Supplier bank details.** Who types them?
   - A) The treasurer types them once into the Node's store (4.7 default). (Recommended.)
   - B) The supplier enters them on their own phone.
3. **Who checks the payout's final state?** The reconciler (4.5) covers pay-ins only.
   - A) Add a payout check to the reconciler in this story, using the simulated processor's state. (Recommended: otherwise "Supplier paid" is only the Node's word.)
   - B) Accept the Node's word for the demonstration and record it as a shortcut.
4. **Supplier choice.** The 4.7 plan lets the treasurer pick when the ranking is not `clear`.
   - A) As in 4.7 (recommended), with the ranking recorded.
   - B) Refuse payment unless the ranking is `clear`.
