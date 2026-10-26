---
title: 'Propose a bulk grocery order'
type: 'feature'
ticket: 2
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

**Problem:** Today an order is only a name typed on each phone, and the items it needs live only on that phone. Two members can type two spellings and see two different lists. There is no budget and no deadline, and nothing says the treasurer has agreed to open quotes and pledges.

**Approach:** Record the proposal as one `order.proposed` event whose id is the order's identity: the name, the wanted items, a budget per member and a deadline. The treasurer records `order.approved`, which opens the order to quotes and pledges. `apply` checks both and judges the deadline at log time. The Orders screen lists every order in the record, not only the one typed.

## Boundaries & Constraints

**Always:** Event id is SHA-512 of the canonical event (rule 5), and it is the order's id. Budget in whole rand cents. Deadline judged at the record's log time, never the wall clock or the sender's claim (`packages/community/src/log-time.ts`, rule 3). Order names checked for phone numbers as well as supplier and item names (closes S-6.8-12). Plain words on screen.

**Never:** Payments, pool or supplier selection (8.3, 4.7). OCR (epic 6). Editing an order after it is proposed; a changed plan is a new order. Storing a member's personal details in the order.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Propose | A joined member enters a name, items, a budget per member and a deadline | `order.proposed` recorded; every member sees it with the budget per member and the deadline | None |
| Missing budget or deadline | Either left out | Refused, naming the missing part | "Add a budget per member." / "Add a deadline." |
| Deadline in the past (log time) | Deadline before the record's log time | Refused | "The deadline has already passed." |
| Phone number in name | "Call 082..." in the order name | Refused | Plain reason (closes S-6.8-12 for order names) |
| Two open orders | A second proposal while one is open (Q4 default) | Refused | "An order is already open." |
| Approve | Treasurer records `order.approved` | Order status open; quotes and pledges allowed | Non-treasurer refused |
| Quote before approval | Treasurer adds a quote before approval | Refused | "Quotes open once the treasurer approves the order." |
| Pledge before approval | Member pledges before approval | Refused | "Pledges open once the treasurer approves the order." |
| Replay | Same event id again | One order | Duplicate receipt |

## Code Map

- `packages/events/src/registry.ts` -- `order.proposed`, `order.approved`, `order.closed` (lines 17-19); add strict validators beside the existing ones (362-373).
- `packages/community/src/apply.ts` -- `CHECKED` (116-129) does not list the order types; add them and their handlers; the quote and pledge handlers gain the open-order check.
- `packages/community/src/quotes.ts`, `pledges.ts` -- add the order-status check; today neither has one.
- `packages/community/src/log-time.ts` -- deadline judged at log time.
- `packages/community/src/community.ts` -- builder pattern for `quote.added` (~389).
- `packages/scenario-stokvel/src/apply.ts` (75-83, 197-215) -- reference only: the demo's order state machine, in memory.
- `apps/shopong/lib/communityEvents.ts` -- add `orderProposedEvent`, `orderApprovedEvent`.
- `miniapps/vendor/orders/src/Orders.tsx` -- order list from the record (replaces the typed "Which order?" as the only way in); "What the order needs" moves to the proposal form.
- `miniapps/vendor/orders/src/host.ts` -- `OrdersHost` gains `orders()` and `propose(input)`.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/events/src/registry.ts` -- strict validators for `order.proposed` (name, items, budget per member, deadline) and `order.approved`.
- [ ] `packages/community/src/orders.ts` -- pure `checkOrder` (plain reasons) and the view keys `orders/<id>`, with status.
- [ ] `packages/community/src/apply.ts` -- handle both types; treasurer-only approval; quote and pledge refused until open.
- [ ] `packages/community/src/orders.test.ts` -- every row of the matrix; two replicas reach the same view; the deadline judged at log time.
- [ ] `miniapps/vendor/orders/src/Orders.tsx` -- propose form and an order list; treasurer "Approve" button.
- [ ] `_bmad-output/initiative-ocn/shortcuts.md` -- close S-6.8-1, S-6.9-2, S-6.8-12 (order names); add rows.

**Acceptance Criteria:**
- Given a joined member proposes an order with items, a budget and a deadline, when another member's phone syncs, then it shows the same name, items, budget per member and deadline.
- Given the order is not yet approved, when a member tries to pledge or the treasurer tries to add a quote, then they are told why and nothing is recorded.

## Implementation Notes

- The order id is the event id, not the typed name. Two phones that type the same name then see one order (closes S-6.8-1).
- The Orders screen's "What the order needs" list is recorded with the order (closes S-6.9-2), so two phones rank the same quotes the same way.
- Quotes and pledges are not gated by order status today (`quotes.ts`, `pledges.ts`). Gating them changes story 6.8 and 4.3 behaviour and their tests.
- The Orders screen reloads quotes only after this phone saves one (S-6.8-6). For a proposal to "appear to all members", the screen must reload from the record on open (Q6).

## Plan Change Log

- 2026-10-26: Refreshed. The draft's claim that the treasurer's approval "opens quotes and pledges" was not in code; it is now a planned event.

## Review Triage Log

(none yet)

## Open Questions

**Answered 2026-10-26 by the product owner: all recommended answers accepted.**


1. **Who may propose.** A) Any joined member, as the demo scenario does. (recommended) B) Only a holder of a new `order/propose` ability; not in `ROLES` today, so this is a role-model change.
2. **Budget.** A) A budget per member in rand, shown with the total (budget per member times members). (recommended) B) One total budget for the order, split equally.
3. **Deadline.** A) A date; after it, new quotes and pledges are refused (judged at log time). (recommended; the refusal changes 4.3 pledge behaviour) B) A date shown only; nothing is refused.
4. **Open orders.** A) One open order per community at a time, as the demo scenario does. (recommended; pool target stays unambiguous, see 8.3 Q2) B) Several open orders at once.
5. **Order id.** A) The proposal's event id, with the typed name as its label. (recommended) B) The typed name as the key.
6. **Seeing new orders without a restart.** A) The Orders screen reloads from the record each time it opens and on pull-to-refresh; no subscription needed. (recommended) B) Wait for the epic 3 subscription (S-6.8-6, S-6.9-11).
7. **Who approves.** A) The creator or a co-treasurer in force at log time, as for quotes. (recommended) B) Two approvers (depends on the approvals rule in 4.7).

## Verification

**Commands:**
- `pnpm exec vp test run packages/community miniapps/vendor/orders` -- expected: all pass
- `pnpm run ci` -- expected: passes

**Manual checks:**
- Web: propose an order with items, budget and deadline; check the order and its items on a second view; approve as treasurer; try a pledge before approval.
- Android emulator: the same; then reopen the Orders screen and check the order appears without restarting the app.
- Not yet checked: two real phones (S-6.8-7), a screen render test for the Orders screen (S-6.8-9, S-6.9-12).

**Shortcuts to close:** S-6.8-1, S-6.9-2, S-6.8-12. **Shortcuts to keep:** S-6.8-2 (supplier names, closed in 8.3 Q3 only if chosen), S-6.9-1 (items match by name), S-6.8-10 and S-6.9-8 (limits chosen, not measured).

</frozen-after-approval>
