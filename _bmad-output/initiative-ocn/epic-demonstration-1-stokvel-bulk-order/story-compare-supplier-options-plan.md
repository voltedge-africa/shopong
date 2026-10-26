---
title: 'Compare supplier options'
type: 'feature'
ticket: 3
created: '2026-10-26'
status: draft
baseline_revision: '5471d90'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Members can see each supplier's quote and a lowest-total recommendation, but as stacked cards, and nothing records which supplier the treasurer chose. The pool's target is read from a `quote.selected` event that is not tied to an order or quote and is not checked, so a typo can set the target.

**Approach:** Show the quotes side by side (items down the side, suppliers across, totals and delivery terms at the bottom, the ranked suggestion and its confidence above). The treasurer picks one supplier, which records `quote.selected` for that order and quote. `apply` checks it against the order and the quote, and the pool target is that quote's total for the order's wanted items.

## Boundaries & Constraints

**Always:** Only the creator or a co-treasurer in force at log time may select (as `pool-read.ts` already requires). `quote.selected` names the order and the supplier; `apply` checks both exist and that the total is a safe whole number of cents, and recomputes it with the same `rankQuotes` the screen uses. Confidence is the rule's margin, not a model (S-6-1). Plain words.

**Never:** Paying (story 4.7). OCR or photos. Changing ranking rules (3% threshold stays). A supplier record with an id (Q3 default keeps names). Showing another member's bank details.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Compare two quotes | Two suppliers complete for the wanted items | Side-by-side view; lowest total and margin shown | None |
| One quote only | One supplier | "Only one quote so far; at least two are needed to compare." (existing `only_one` state, shown as plain words) | None |
| Quote incomplete | A supplier misses a wanted item | Listed as "missing an item", not ranked (existing) | Plain reason |
| Too close | Lowest within 3% | No recommendation; both shown (existing `too_close`) | None |
| Select | Treasurer selects a supplier | `quote.selected` recorded with order, supplier and total; pool target updates | None |
| Select by a member | Non-treasurer selects | Refused | "Only the treasurer can choose a supplier." |
| Select with no quote | Supplier has no quote for the order | Refused | "No quote from that supplier for this order." |
| Select before approval | Order not approved | Refused | "Approve the order first." |
| Later selection | Treasurer selects another supplier | Latest selection stands; earlier kept in log | None |
| Bad total | A hand-made `quote.selected` with a non-integer total | Refused by `apply`; pool target unchanged | Plain reason (closes S-4.6-14) |

## Code Map

- `packages/community/src/rank.ts` -- `rankQuotes`, `RANKING_THRESHOLD_PERCENT` (3), `Recommendation`.
- `miniapps/vendor/orders/src/ranking.ts` -- `orderRanking`, `RankRow` (~48), the view model for the comparison.
- `miniapps/vendor/orders/src/Orders.tsx` -- `QuoteCard` (stacked today), `RankingCard` (~179); the comparison goes here.
- `packages/events/src/registry.ts` -- `quote.selected` (line 21); add a strict validator (order, supplier, totalMinor).
- `packages/community/src/apply.ts` -- `CHECKED` (116-129) does not list `quote.selected`; add it and a handler.
- `apps/node/src/pool-read.ts` -- `TARGET_TYPE` (~40), `targetOf` (~120-140): reads the latest selection, not tied to an order (S-4.6-4).
- `packages/community/src/quotes.ts` -- `quotesOf`, `quoteKey`.
- `_bmad-output/initiative-ocn/shortcuts.md` -- S-4.6-4, S-4.6-14, S-6.9-12.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/events/src/registry.ts` -- strict validator for `quote.selected`: `order`, `supplier`, `totalMinor` (safe whole number of cents).
- [ ] `packages/community/src/apply.ts` -- handle `quote.selected`: treasurer only, order approved, quote exists, total equals `rankQuotes` total for the order's wanted items.
- [ ] `apps/node/src/pool-read.ts` -- read the target for the order named in the selection; keep the rule that only a treasurer's selection counts.
- [ ] `miniapps/vendor/orders/src/Orders.tsx` -- side-by-side comparison (Q4), with the ranking above it; "Choose this supplier" for the treasurer.
- [ ] Tests: `packages/community/src/quotes-select.test.ts` (matrix rows), `apps/node/src/pool-routes.test.ts` (target follows the selection).
- [ ] `_bmad-output/initiative-ocn/shortcuts.md` -- close S-4.6-4 and S-4.6-14; add rows for anything kept.

**Acceptance Criteria:**
- Given two complete quotes for an approved order, when a member opens Orders, then the comparison shows price per item, totals, delivery terms for each supplier, and the ranked suggestion with its margin.
- Given the treasurer chooses a supplier, when another member's phone syncs, then it shows the same choice, and the pool target becomes that quote's total.

## Implementation Notes

- The pool target was a bare `totalMinor` with no order (S-4.6-4). Once selections name an order, the Node must read the target for the order the pool is for. Q2 keeps one open order at a time, so this is unambiguous for the demo.
- `packages/community/src/rank.ts` and `ranking.ts` exist and are tested. The plan for 6.9 still says `draft`; the orchestrator should reconcile that after review.
- The ranked total must match what `apply` recomputes, or the pool target and the screen disagree. Use the same function on both sides.

## Plan Change Log

- 2026-10-26: Refreshed. Recorded that `quote.selected` exists in the registry and the Node reads it, but no screen writes it and `apply` does not check it.

## Review Triage Log

(none yet)

## Open Questions

**Answered 2026-10-26 by the product owner: all recommended answers accepted.**


1. **Which total is the pool target.** A) The ranked total for the wanted items (cheapest line per item, packs counted, delivery fee once), recomputed by `apply`. (recommended) B) The full quote total, including items the order does not need.
2. **Changing the choice.** A) The latest treasurer selection for the open order stands; earlier ones stay in the log. (recommended) B) The first selection locks.
3. **Supplier identity.** A) Keep the typed supplier name, exact after tidying (S-6.8-2), and show a note that two spellings are two suppliers. (recommended) B) Add supplier records with ids now (larger change; closes S-6.8-2).
4. **Comparison layout.** A) A table: items down the side, suppliers across, totals and delivery at the bottom; scroll sideways on a narrow phone. (recommended) B) Keep stacked cards with the ranking above.
5. **Delivery days.** A) Shown, but not counted in the ranking (S-6.9-7 stays open). (recommended) B) Count days in the ranking (a rule change to 6.9).

## Verification

**Commands:**
- `pnpm exec vp test run packages/community apps/node miniapps/vendor/orders` -- expected: all pass
- `pnpm run ci` -- expected: passes

**Manual checks:**
- Web: two complete quotes; check the table, totals, delivery and the ranked suggestion; select a supplier as treasurer; check the pool target on the pool view.
- Android emulator: the same; rotate or resize to check the sideways scroll on a narrow width.
- Not yet checked: a render test of the comparison (S-6.9-12, S-6.8-9); two real phones (S-6.8-7).

**Shortcuts to close:** S-4.6-4, S-4.6-14. **Shortcuts to keep:** S-6.9-7 (delivery days), S-6.9-9 (ties by name), S-6.9-13 (item name matching), S-6-1 (typed quotes, rule confidence until OCR).

</frozen-after-approval>

---

## Questions for the product owner (summary)

Each question's first option is the recommended answer. The full question is in each story's Open Questions.

**8.1**
1. Name and rules in the record (new `community.named` event)? Recommended: yes.
2. Approvals setting 1 to 5? Not in code. Recommended: not in 8.1; set with the pool rule in 4.7.
3. Creating while offline? Recommended: keep it online-only; offline sync covers invitations and roles.
4. Proof of a join? Recommended: a real join between two devices, recorded in the PR.
5. Who sees roles? Recommended: every member.

**8.2**
1. Who may propose? Recommended: any joined member.
2. Budget? Recommended: per member in rand, shown with the total.
3. Deadline enforced or shown? Recommended: enforced for new quotes and pledges, judged at log time (changes 4.3).
4. One open order at a time? Recommended: yes for the demo.
5. Order id? Recommended: the proposal's event id.
6. New orders without restart? Recommended: reload from the record on open and pull-to-refresh.
7. Who approves? Recommended: creator or co-treasurer in force.

**8.3**
1. Pool target total? Recommended: the ranked total for the wanted items, recomputed by `apply`.
2. Changing the selection? Recommended: latest treasurer selection stands.
3. Supplier identity? Recommended: keep typed names for the demo.
4. Comparison layout? Recommended: a table with items down and suppliers across.
5. Delivery days in ranking? Recommended: shown, not counted.

## Shortcut rows these stories should close

| Story | Closes | Note |
|---|---|---|
| 8.1 | S-3.4-1 (name not in any event), S-2.3-14 (joiner never sees name) | Needs Q1 yes |
| 8.2 | S-6.8-1 (order is a typed name), S-6.9-2 (wanted list only on the phone), S-6.8-12 (phone numbers not checked in order names) | Needs Q5 and Q6 |
| 8.3 | S-4.6-4 (quote.selected not tied to order, not checked), S-4.6-14 (bad later target skipped) | Needs Q1 and Q2 |

Shortcuts that stay open after all three (not owned by these stories): S-2.3-3 and S-6.8-7 (two real phones; 8.1 Q4 may close S-2.3-3), S-6.8-6 and S-6.9-11 (no subscription; 8.2 Q6 is a partial answer), S-6.8-9 and S-6.9-12 (no render tests), S-6.8-2 (supplier names), S-6.9-7 (delivery days), S-6-1 (typed quotes until OCR). There are no S-4.7-* rows yet; story 4.7 is still `draft`.

## Status drift to reconcile (orchestrator)

- `story-rank-quotes-by-a-simple-rule-plan.md` (6.9) is `draft`, but `rank.ts` and the RankingCard are built.
- `story-typed-supplier-quotes-plan.md` (6.8) is `done`, as expected.
- `story-approve-and-pay-a-supplier-from-the-pool-plan.md` (4.7) is `draft`; no payout code exists in `apps/node` yet (`pool-read.ts` is the target reader only).
- The `approvals setting (1 to 5)` and `community rules` in the earlier brief are not in code, so they are proposed here as questions, not as existing facts.

## Not done

Nothing was run: no `vp test`, no web or Android check, no Node server. The "verified" lines above are the plan's requirements, not results.
