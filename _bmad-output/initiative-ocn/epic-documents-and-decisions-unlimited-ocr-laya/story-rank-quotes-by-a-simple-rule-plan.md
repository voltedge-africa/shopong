---
title: 'Rank quotes by a simple rule'
type: 'feature'
ticket: 9
created: '2026-10-26'
status: done
baseline_revision: 'bc9526b'
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

**Problem:** Members need to see which supplier quote is best and why, in a way anyone can check (AD-23). A model is not ready.

**Approach:** A pure function takes the complete quotes for an order and the order's wanted items and quantities, works out each supplier's total (items plus delivery fee), ranks them lowest first, and states the margin to the next supplier as the confidence. When the margin is below a set threshold it says "no clear recommendation". Quotes that do not cover every wanted item are listed as incomplete and not ranked. The result is shown on the Orders screen. The function sits behind the `Decide` port's idea only in name: no model, and the `Decide` port is untouched.

## Boundaries & Constraints

**Always:** Same quotes in, same ranking out, in any order (ties broken by supplier id). Integer cents, no floating point in totals. The rule and the threshold are written in plain words in the screen ("Lowest total wins. If the next supplier is within 3% we don't pick one."). Delivery terms are shown beside each total.

**Never:** Laya, OCR, or any model. Choosing the supplier (a person does that). Weighting by reliability or reviews. Changing quotes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Clear winner | Three complete quotes, the lowest 10% below the next | Rank 1, 2, 3, each with total and margin to the next; a recommendation | None |
| Too close | Lowest within the threshold of the next | "No clear recommendation", ranks still shown | None |
| One quote | Only one complete quote | Shown as the only option, no margin, "only one quote" | None |
| Incomplete | A quote missing a wanted item | Listed under "can't compare: missing <item>", not ranked | None |
| Tie | Equal totals | Ordered by supplier id; "no clear recommendation" | None |
| None | No complete quotes | "No quotes to compare yet" | None |
| Order of input | Same quotes shuffled | Identical result | None |

</frozen-after-approval>

## Code Map

- `packages/community/src/quotes.ts` -- the quote type (from story 6.8, which must land first).
- `packages/ports/src/decide.ts` -- not changed, read to avoid clashing names.
- Orders mini app screen -- where the ranking is shown.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/community/src/rank.ts` -- the pure ranking function and the threshold constant
- [ ] `packages/community/src/rank.test.ts` -- every matrix row, plus a property test that shuffling input never changes output
- [ ] The Orders screen -- show rank, total, delivery terms, margin and the rule in plain words; check on web
- [ ] `_bmad-output/initiative-ocn/shortcuts.md` -- rows for shortcuts

**Acceptance Criteria:**
- Given the same quotes, when ranked twice or in a different order, then the result is identical.
- Given a margin below the threshold, when ranked, then the screen says there is no clear recommendation.

## Implementation Notes

## Plan Change Log

## Review Triage Log

Pass 1 (one Haiku read-only reviewer, 2026-10-26). 10 findings: 1 high, 1 medium, 8 low. One more gap found by the orchestrator's mutation check.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | The card never shows which needs it ranked for, so two phones can disagree silently | high, real | patch | Card starts with "Ranked for: ..."; test failed first; seen on web and emulator. The per-phone list itself is accepted as S-6.9-2 until story 8.2 supplies it from the record |
| 2 | Quotes for one order could show under another order's name while loading, or stay if loading failed | medium, real | patch | Cleared on name change, filtered by order, plain failure message; test failed first |
| 3, 4 | Quantity messages did not say what was wrong | low, real | patch | Plain sentences for too large and for commas; tests |
| 5 | "Only one quote" headline when others are incomplete | low, real | patch | "Only one quote can be compared so far."; test |
| 6 | A tiny margin read "0.0% more" | low, real | patch | "less than 0.1% more"; test |
| 7 | Item names are not matched across Unicode forms or zero-width characters | low, real | defer | S-6.9-13 |
| 8 | Wanted-list problems came back in input order | low, real | patch | Sorted; test |
| 9 | Duplicate React keys for identical problem lines | low, real | patch | Index plus text |
| 10 | One supplier over 2^53 makes the whole ranking refuse | low, unreachable from the UI | defer | S-6.9-14 |
| 11 | (mutation check) Removing the tie-break changed no test | medium, real | patch | The redundant pre-sort was removed; a test over all 24 input orders of tied suppliers now fails without the tie-break |

## Open Questions

**Answered 2026-10-26 by the product owner: all recommended answers accepted.**

1. **Threshold.** A) 3% of the lowest total (recommended). B) A fixed rand amount.
2. **Margin as "confidence".** A) Show it as "R x cheaper than the next" and a percentage, not as a probability (recommended; honest, not a model score). B) Call it confidence.
3. **Incomplete quotes.** A) Not ranked, shown with the reason (recommended). B) Ranked on what they cover.

## Verification

**Commands:**
- `pnpm exec vp test run packages/community` -- expected: all pass
- `pnpm run ci` -- expected: passes

**Manual checks:** On web, with three typed quotes, see the ranking and the plain-word rule; make two quotes close and see "no clear recommendation".
