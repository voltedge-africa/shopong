---
title: "Collect and close the order"
type: "integration"
ticket: 7
created: "2026-10-26"
status: draft
baseline_revision: "5471d90"
risk: "high"
hitl: true
depends_on: ["7.6 (not built)", "8.6", "4.8 (not built)"]
covers: ["FR16"]
---

### Intent

**Problem:** An order is complete only when each member has collected their share and the treasurer has closed it with a summary that every member can read: what each member paid, what their share was, whether anything is owed back or still outstanding, and the full timeline. Today the close event (`order.closed`) is in the registry, but `apply` does not check it, and member collection (`collection.confirmed`) is not checked either.

**Approach:** Compose 7.6 (collection confirmation, once built) and the record's events into a closing screen for the treasurer, with a human confirmation before the order closes (hitl). The summary reads the record and the pool; it does not compute money. Without 4.8, the summary cannot pay anything back: it shows any difference as words, and says that nothing has moved.

### Boundaries & Constraints

**Always:** Every collection is the member's own confirmation (`collection.confirmed`, 7.6). The treasurer confirms the close on the screen before `order.closed` is sent (AGENTS rule 8: a money-affecting action needs a human). The summary reads the record and the pool view (4.6); it does not sum on the phone. `order.closed` is refused unless every admitted member has a collection confirmed at log time (to be added to `apply`).

**Never:** Refunding or moving money in this story (4.8). Creating `obligation.created` events (FR20 is epic 9 and 10). Showing other members' bank details or phone numbers. A close that a non-treasurer sends.

### I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| All collected, treasurer closes | Every member has `collection.confirmed`; treasurer confirms | `order.closed` recorded; summary and timeline shown to all | None |
| One member has not collected | One admitted member has no confirmation | Close refused; treasurer sees who is missing | "Not everyone has collected yet: <names>." |
| Not the treasurer | A member sends the close | Refused | "Only the treasurer can close an order." (new message, to be added) |
| Difference, member overpaid | Paid is more than share | Shown as "credit, still in the pool"; nothing is paid back | None |
| Difference, member underpaid | Paid is less than share | Shown as "still to pay"; an open item in the list | None |
| Close replayed | Same event id again | One close | Receipt says duplicate |
| Delivery not confirmed | No `delivery.confirmed` | Close refused | "The delivery has not been confirmed yet." |

### Code Map

- `packages/events/src/registry.ts` -- `order.closed` (line 19), `collection.confirmed` (line 32), `obligation.created` (line 36), `payment.refunded` (line 26). Registered; `payload` checks not confirmed for `order.closed`.
- `packages/community/src/apply.ts` -- `CHECKED` set (line ~112): includes `delivery.confirmed`, does **not** include `order.closed` or `collection.confirmed`. The default branch is `quoteAdded`, so these two types are not checked today.
- `packages/scenario-stokvel/src/steps.ts` -- step `collect` (about line 592) and `close-order` (about line 611). `order.closed` carries per-member `paidMinor`, `shareMinor`, `creditMinor`, and the total; the step says the credit "stays in the pool as credit for the members". Use as the expected output and as the design to confirm (question 1).
- `packages/community/src/pool.ts` -- `PoolReading.members` (per-member liability by opaque id). Exists.
- `apps/node/src/pool-read.ts` -- `memberIdOf` (HMAC under the Node's master key). The phone cannot compute these ids (see question 2).
- `_bmad-output/initiative-ocn/epic-logistics-map-route-delivery-duckdb-wasm-kepler-gl-valhalla/story-proof-of-delivery-and-proof-of-collection-plan.md` -- 7.6, draft; defines `collection.confirmed` and the driver's `delivery.confirmed`.
- `_bmad-output/initiative-ocn/epic-pooled-money-ledger-and-payments-ledfra-stitch/story-refunds-shortfalls-and-partial-funding-plan.md` -- 4.8, draft, not built.

### Tasks & Acceptance

**Execution:**
- [ ] Add `order.closed` and `collection.confirmed` to `apply`'s `CHECKED` set with the log-time rules above; tests for each row of the matrix in `packages/community/src/`.
- [ ] Closing screen for the treasurer: per-member paid, share and difference in words; the timeline from the record; the open items. Confirm before sending (hitl).
- [ ] Per-member summary: each member sees their own line in full, and the group total. Other members' names come from the record's member list (question 2).
- [ ] Timeline: the events in order, from `order.proposed` to `order.closed`, each with a plain sentence (the scenario's `show.title` wording is the model).
- [ ] Open items: members who have not paid (8.4), members who have not collected (7.6), and any "still to pay" difference. These are a list in the view; no obligation event is written.
- [ ] Scenario check: the snapshot after `close-order` matches the closing screen's figures.
- [ ] `_bmad-output/initiative-ocn/shortcuts.md` -- rows for every item in Shortcuts.

**Acceptance Criteria:**
- Given every member has confirmed collection, when the treasurer confirms the close, then the order closes with a per-member summary, the full timeline and the open items.
- Given one member has not collected, then the close is refused and the treasurer is told who is missing.
- Given `pnpm run ci`, then it passes.

### Shortcuts

- **Add:** S-8.7-1, the difference is shown as words only; no money moves, because 4.8 is not built. Revisit when 4.8 merges.
- **Add:** S-8.7-2, open items are a view list, not `obligation.created` events; FR20 is epic 9 and 10. Revisit with epic 10.
- **Add:** S-8.7-3, the credit stays in the pool (the scenario's choice) until the product owner decides refund or credit (question 1).
- **Retire:** none in the existing register for this story.

### Verification

**Commands:** `pnpm run test`, `pnpm run ci`.

**Manual, both every time:**
- Web: close an order with all five members collected; close one with a member missing and see the refusal; screenshot the summary and the timeline.
- Android emulator: the same on Expo Go; check the summary fits on a small screen. Note what was not checked.

### What 8.7 can honestly do without 4.8

- Show each member's paid amount, share and difference, in words.
- Show the order total from the selected quote, and the pool's collected figure.
- Show the full timeline from the record.
- Show open items: unpaid shares, uncollected shares, and differences.
- Show "credit, still in the pool" for an overpayment. It must not say "refunded" (the state word `refunded` is for 4.8).
- It cannot pay back, reverse a posting, or net a shortfall. Those are 4.8.

### Open Questions

**Answered 2026-10-26 by the product owner: all recommended answers accepted.**


1. **Credit or refund at close?** The scenario's close step keeps overpayments in the pool as credit.
   - A) Keep credit in the pool for this demonstration and say so on the summary. (Recommended: no money moves without 4.8.)
   - B) Hold the close until 4.8 has refunded every difference.
2. **Member names in the summary.** The pool identifies members by opaque ids (S-4.6-7).
   - A) Names from the record's member list (`member.joined`), shown to members of the community only. (Recommended, but confirm the record holds the display name; not verified in this read.)
   - B) Ids only, with the treasurer seeing names through a separate screen.
3. **Open items for follow-up.** FR20 (obligations) is epic 9 and 10.
   - A) A list in the view, no obligation events. (Recommended.)
   - B) Write `obligation.created` now, which needs the apply rule that epic 10 owns.
4. **Who confirms the close?**
   - A) The treasurer confirms on the closing screen. (Recommended; hitl.)
   - B) Any co-treasurer can close.
