---
title: 'Pooled funds and member balances view'
type: 'feature'
ticket: 6
created: '2026-10-26'
status: draft
baseline_revision: '788a54d8ab1c5cedcf4ab94ed00f62779eefa091'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Members cannot see what the pool holds, what each has paid, or where each stands. The books (the ledger on the OCN Node) and the shared record can disagree. A view that quietly shows one of them hides that disagreement.

**Approach:** A read-only pool view computed on the Node. The pool total, each member's own contribution and each member's status come from the ledger's balances. The Node compares the ledger with the record's money events and returns any difference as a flag with both amounts. The phone shows the figures and the flag; it does no money arithmetic of its own.

## Boundaries & Constraints

**Always:** Balances come only from the `Ledger` port (`balance`, `trialBalance`). The read request is signed and checked at the Node. A mismatch is shown with both amounts and the difference, and the ledger total still shows. Member ids are opaque; no phone numbers or ID numbers on screen. Plain words for every state.

**Never:** Posting, paying, or changing the ledger or the record. Calling Stitch. Refunds or partial funding (story 4.8). Showing one member's amount to another member (see question 2). Showing a total as current when the Node cannot be reached.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Books and record agree | Pool R500.00 in the books; R500.00 of mirrored payments in the record | Totals shown, no flag | None |
| Mismatch | Books R500.00; record R450.00 | Totals shown with "The books show R500.00 but the shared record shows R450.00. The difference is R50.00." | Flag, never hidden |
| Own contribution | Own member account R100.00 | "You have paid R100.00" | None |
| Not yet paid | Own member account zero | "You have paid R0.00"; status "Waiting" | None |
| Target met | Each member's share paid | Status "Paid" for each | None |
| No target | No target in the record | Totals shown; status "No target yet" | None |
| Member account with no member | A liability for an id the record does not list | Flag: "A member account has no matching member in the record." | Flag, never hidden |
| Node unreachable | Request times out | "We can't reach the Node. Figures may be out of date." No totals shown as current | Retry button |
| Books unreadable | Ledger read throws | "The books can't be read right now." | Nothing shown |
| Not a member | Caller holds no role here | Refused | "You are not a member of this community." |

## Code Map

- `packages/ports/src/ledger.ts` -- `balance`, `trialBalance` (read only).
- `packages/ledger-sqlite/src/chart.ts` -- `POOL_BANK`, `memberLiability`; `ledger.ts` is the adapter.
- `packages/adapters-memory/src/ledger.ts` -- in-memory ledger for tests.
- `packages/events/src/registry.ts` -- `payment.completed`, `ledger.posted` (both exist).
- `packages/community/src/roles.ts` -- `ROLES`, `ACTIONS`; `ledger/read` is named in the architecture but is not yet a role ability.
- `packages/community/src/quotes.ts` -- `isTreasurer` (who may see treasurer figures).
- `apps/node/src/authority.ts`, `apps/node/src/signed.ts` -- the signed-route pattern to copy for `GET /pool`.
- `apps/node/src/app.ts`, `apps/node/src/hub.ts` -- route registration and the record view.
- `apps/shopong/components/CommunityCard.tsx`, `apps/shopong/lib/community.ts` -- where the view appears and calls the Node.
- `_bmad-output/initiative-ocn/shortcuts.md` -- rows for shortcuts taken.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/community/src/pool.ts` (new) -- pure `poolView`: from ledger balances, record totals, target and members, returns totals, statuses and flags in plain words
- [ ] `apps/node/src/` -- signed `GET /pool` (ledger/read checked at the Node), 503 when the ledger is not configured; tests on the in-memory ledger
- [ ] Record mirror of each posting (AR6), if not already written by the posting path; see question 3
- [ ] `apps/shopong/` -- pool card on the community screen: totals, own contribution, statuses, flags, "can't reach the Node" state
- [ ] `_bmad-output/initiative-ocn/shortcuts.md` -- a row for each shortcut taken

**Acceptance Criteria:**
- Given the books and the record agree, when the view loads, then the totals equal the ledger balances and no flag shows.
- Given they differ, when the view loads, then the flag shows both amounts and the difference, and the ledger total still shows.
- Given the Node cannot be reached, then no total is shown as current.
- Given `pnpm run ci`, then it passes.

## Verification

**Commands:**
- `pnpm run test` -- expected: all pass, including `pool.ts` rows of the matrix
- `pnpm run ci` -- expected: passes

**Manual (both, every time):**
- Web: run `apps/shopong` in the browser with a seeded pool; check each matrix row with a screenshot.
- Android emulator: the same rows on Expo Go, following the emulator workflow note.

## Open Questions

**Answered 2026-10-26 by the product owner: all recommended answers accepted (first option of every question). Testing rule: any story that changes the app is checked on web AND the Android emulator, every time; any older wording that says the emulator is checked only when asked is out of date. Stitch is simulated until the product owner has the Stitch account; the simulation is labelled everywhere and recorded as shortcuts.**

1. **Where do the target and each member's share come from?** The ledger has no target account, the chart has no target, and no share rule exists in merged code.
   - A) Read from the record: the pool's target event, split equally across members unless the record sets a split. The view names this source. (Recommended: the ledger holds money, not plans.)
   - B) Add a memo account to the chart that holds the target.
   - C) Post the target as a transaction.
2. **Who may see what?**
   - A) Each member sees their own amount and every member's status only. (Recommended: matches "their own contribution" in the brief.)
   - B) Every member sees everyone's amounts.
   - C) Only the treasurers see amounts.
3. **Who writes the mirror events the check compares against?** The epic assumes story 4.2 mirrors each posting (AR6), but the merged `ledger-sqlite` writes nothing to the record.
   - A) This story adds the mirror write to the Node's posting path, so the check holds from the first money event. (Recommended.)
   - B) Story 4.5 writes the mirror when it posts a confirmed pay-in.
   - C) Defer the check: every total shows as "not yet checked" until a mirror exists.
4. **Where does the view live?**
   - A) A pool card on the community screen in `apps/shopong`. (Recommended: no new package.)
   - B) A new vendor mini app, `miniapps/vendor/pool`.
5. **Verification scope.** The brief asks for web and Android emulator every time, but the stored preference is the emulator only when asked.
   - A) Both, as the brief says, for this story. (Recommended: the product owner set it in the brief.)
   - B) Web only, with the emulator run on request.
6. **Could not verify:** whether the Node has the `ledger/read` ability in any role today (it does not appear in `ROLES`), and whether the record view exposes money events by key without a scan. Both need a check before tasks start.
