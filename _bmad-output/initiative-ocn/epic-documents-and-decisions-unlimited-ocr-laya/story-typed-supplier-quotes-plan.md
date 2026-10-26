---
title: 'Typed supplier quotes'
type: 'feature'
ticket: 8
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

**Problem:** To compare suppliers, members must see each supplier's prices and delivery terms in the shared record. OCR is not ready (AD-23), so the treasurer types them.

**Approach:** A quote is a supplier, a list of lines (item, unit, pack size, price per pack in rand cents) and delivery terms. A pure function checks a typed quote and refuses an incomplete one with a plain reason. A complete quote becomes a `quote.added` event (existing event type, existing envelope) that the community's `apply` stores in the view so every member sees it. A simple form on the treasurer's side lets them type it. The `Ocr` port is left untouched, ready to feed the same function later.

## Boundaries & Constraints

**Always:** Only a member with the treasurer authority may add a quote (the same role check the community package uses). Prices are whole cents, integers, above zero. The shape is checked in `apply` as well as in the form, and `apply` stays deterministic. Words shown to people are plain language. No personal details in a quote (supplier is a name or id, not a phone number).

**Never:** OCR, photos or file upload. Ranking (story 6.9). Editing or deleting a quote (a changed quote is a new `quote.added` that supersedes by supplier and order). Choosing a supplier (`quote.selected` belongs to Demonstration 1 story 8.x).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Complete quote | A treasurer types 3 lines and delivery terms | `quote.added` recorded; another member's replica shows it | None |
| Missing price | A line with no price | Refused, naming the line and "price missing" | Reason shown, nothing recorded |
| Zero or negative price | A price of 0 | Refused | Reason shown |
| No lines | A quote with no lines | Refused | "Add at least one item" |
| Not a treasurer | A plain member sends it | Refused | `not_permitted` as the community package already reports |
| Newer quote | The same supplier and order again | The newer quote replaces the older in the view; both stay in the log | None |
| Replay | The same event id again | One quote | Receipt says duplicate |

</frozen-after-approval>

## Code Map

- `packages/events/src/registry.ts` -- `quote.added` already exists; check whether a payload schema exists for it.
- `packages/community/src/apply.ts`, `roles.ts` -- where the view and the role check live.
- `packages/community/src/community.test.ts` -- test style.
- `miniapps/` -- where the Orders / Quotes screen would live; read `miniapps/README.md`.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/community/src/quotes.ts` -- the quote type, `checkQuote` (pure, plain reasons), and the view part that stores quotes per order and supplier
- [ ] `packages/community/src/apply.ts` -- handle `quote.added` through the same function, treasurer only
- [ ] `packages/community/src/quotes.test.ts` -- every row of the matrix, plus two replicas reaching the same view
- [ ] A simple "Add a quote" form (screen) for the treasurer, in the mini app the plan for epic 6 names; check on web
- [ ] `_bmad-output/initiative-ocn/shortcuts.md` -- rows for shortcuts

**Acceptance Criteria:**
- Given a quote typed by the treasurer, when another member's replica syncs, then it shows the same lines, prices and delivery terms.
- Given an incomplete quote, when the treasurer submits, then they are told exactly what is missing and nothing is recorded.

## Implementation Notes

## Plan Change Log

## Review Triage Log

Pass 1 (one Haiku read-only reviewer, 2026-10-26). 8 findings: 1 high, 3 medium, 4 low. One more gap found by the orchestrator's mutation check.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | A comma used as a decimal ("12,50") became R1250 | high, real | patch | Comma accepted only as thousands groups; anything else refused with "write the price like 125.50"; test failed first; mutation-checked; checked on web and emulator |
| 2 | A phone number next to words in a supplier name was accepted | medium, real | patch | A run of 7 or more digits is refused in supplier and item names; test failed first; mutation-checked |
| 3 | An expired co-treasurer can backdate a quote | medium, known | defer | S-6.8-5 and S-6.8-11 (same gap as S-2.4-5) |
| 4 | No bound on name length, control characters, line count | medium, real | patch | Limits and plain reasons; tested at the edge |
| 5 | Very large prices and sizes accepted | low, real | patch | Limits (R100,000 per pack and fee, 10,000 per pack size, 90 days) |
| 6 | Internal whitespace not folded in names | low, real | patch | Folded to one space; tested |
| 7 | Raw port error (with a DID) could reach the screen | low, real | patch | Mapped to a plain sentence; tested |
| 8 | A stale reply could overwrite the list for a newer order | low, real | patch | Cancel flag; no render test (S-6.8-9) |
| 9 | (mutation check) Removing apply's shape check changed no test | medium, real | patch | Tests write malformed quotes straight to the record; 4 fail with the check removed |

## Open Questions

**Answered 2026-10-26 by the product owner: all recommended answers accepted.**

1. **Price unit.** A) Price per pack in rand cents (recommended). B) Price per unit.
2. **Delivery terms.** A) A fee in cents and a number of days (recommended). B) Free text.
3. **Where it waits** (story 3.2 is now merged, so build on the real record): This story needs 3.2 only for the real record; it can be built and tested on the in-memory record first. A) Build now on in-memory (recommended). B) Wait for 3.2.

## Verification

**Commands:**
- `pnpm exec vp test run packages/community` -- expected: all pass
- `pnpm run ci` -- expected: passes

**Manual checks:** On web, type a quote as treasurer, then see it as another member.
