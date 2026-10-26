---
title: "Pledge and pay, with funding progress"
type: "integration"
ticket: 4
created: "2026-10-26"
status: draft
baseline_revision: "5471d90"
risk: "high"
hitl: false
depends_on: ["4.3", "4.5", "4.6", "3.2"]
---

### Intent

**Problem:** Members must each commit their share and pay it, and everyone must see how far the pool has got. The pieces exist on main but are not yet shown as one flow with the plain words the epic promises. A member who has not paid must not be shown as having paid, and no bank detail may appear on a member's screen.

**Approach:** Compose the merged 4.3 pledge and pay, the 4.5 webhook confirmation and the 4.6 pool view into the demonstration flow. A member pledges in the Orders screen, pays through the simulated bank page in the in-app browser tab, and sees their own state change to Paid when the Node confirms. Every member sees the pool figure and their own status change. Add only what is missing: the plain status words the epic names, the funding bar if it is not there, and the integration test that walks one pledge from requested to paid.

### Boundaries & Constraints

**Always:** The Node is the only writer to the bank rail (AD-3, AGENTS rule 4). A pledge is shown as paid only when the Node's status says `completed` (S-4.3-11). The pool figures come from the Node's pool route, never from the phone's own sum. Member ids in the pool are opaque (S-4.6-7). Amounts are whole cents. Every money screen carries the simulated label.

**Never:** Showing a bank account, a bank reference that a member can reuse, or a phone number on a member's screen. Calling Stitch directly from the phone or the console. Changing the pledge limits (R1.00 to R3,000.00 in `packages/community/src/pledges.ts`, `PLEDGE_LIMITS`) without the sandbox check in S-4.3-8. Adding a new payment type to the registry.

### I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Pledge and pay | Member pledges an amount in the Orders screen, then taps Pay | Requested, then Paid after the Node's webhook confirmation; the member's own card and the pool card update | None |
| Payment not yet confirmed | Member has paid at the bank page but the webhook has not arrived | "Waiting" with "Check again"; never "Paid" | Node status route answers `pending` |
| Unpaid member | A member has pledged nothing or has not paid | Shown as **Waiting** (the pool's word, `POOL_STATUS_LABELS.waiting`), with no bank detail | None |
| Part paid | A member has paid part of their share | "Part paid" (`part_paid`) | Wording open, see question 2 |
| Pool progress | Several members have paid | Every member sees the same pool figure and target from the Node | If the Node cannot be reached, "We can't reach the Node. Figures may be out of date." (`UNREACHABLE_MESSAGE`) |
| Late or failed payment | Payment window passed (3 days) or processor reports failed | "Your pledge's time to pay has run out" or "failed"; "Pay again" makes a new pledge (S-4.3-7) | Plain sentence from `pay.ts` |
| Replay | Same webhook delivered twice | One confirmation; pool unchanged the second time | Node acknowledges with 200 (S-4.5-13) |
| No bank details shown | Any member's view | No account number, branch, or phone on screen | Test asserts the rendered text does not contain them |

### Code Map

- `packages/community/src/pledges.ts` -- `checkPledge`, `PLEDGE_LIMITS`, `pledgeKey`, `paymentKey`. Exists.
- `apps/node/src/payment-request-route.ts` -- `POST /payments/requests`, `GET /payments/status`, 3-day window (`PAYMENT_WINDOW_MS`). Exists.
- `apps/node/src/payments-routes.ts` -- `POST /webhooks/payments` (S-4.5-1). Exists.
- `apps/node/src/payment-confirmation.ts`, `apps/node/src/pledge-to-confirmation.test.ts` -- pledge to confirmation on the Node. Exists.
- `apps/node/src/pool-routes.ts`, `apps/node/src/pool-read.ts` -- `GET /communities/:key/pool`. Exists.
- `packages/community/src/pool.ts` -- `POOL_STATUS_LABELS`, `poolView`. Exists.
- `apps/shopong/lib/pool.ts` -- `poolScreenOf`, `poolSections`, `freshnessOf`, `STALE_AFTER_MS`. Exists.
- `apps/shopong/lib/CommunityProvider.tsx` -- `pool`, `refreshPool`, the pool timer (S-4.6-8). Exists.
- `apps/shopong/components/PoolCard.tsx` -- the pool card. Exists. Check whether it draws a bar. A per-order funding bar was not found in the files read; if there is none, it is the one new UI piece.
- `miniapps/vendor/orders/src/pay.ts` -- `payCardOf`, `actionLabel`, `createSingleFlight`, `SIMULATED_NOTE`. Exists.
- `miniapps/vendor/orders/src/Orders.tsx` -- `PayPanel` (about line 221). Exists.
- `packages/scenario-stokvel/src/steps.ts` -- steps `pledges`, `payments`, `retry-payment`, `pool-funded`. Use as the expected output.
- `_bmad-output/initiative-ocn/shortcuts.md` -- rows S-4.3-*, S-4.5-*, S-4.6-* (see Shortcuts below).

### Tasks & Acceptance

**Execution:**
- [ ] Walk the demonstration order's pledge and pay steps in the real Orders screen on web (simulated bank page). Record the Node and screen states at each step. Fix any step that does not reach Paid.
- [ ] Change the word for an unpaid member to the one the epic names (question 1), and keep `pay.ts` and `POOL_STATUS_LABELS` in agreement. Add a test that fails on the old word.
- [ ] Add a funding bar to the pool card if it is absent: target from the Node, collected from the Node, no phone-side sum. Test with the in-memory ledger.
- [ ] Integration test (Node plus phone logic): five members, one pledge per member, one replay of a webhook, and one unpaid member. Assert the pool figures and the statuses match `scenario-stokvel`'s `pool-funded` snapshot.
- [ ] Test that no rendered member text contains an account number, branch or phone number.
- [ ] Enable the ledger component in the demo Node configuration (`OCN_NODE_LEDGER_ENABLED`) and document it in `.env.example` with a placeholder. No secret.
- [ ] `_bmad-output/initiative-ocn/shortcuts.md` -- retire or update the rows listed under Shortcuts, and add a row for each shortcut taken.

**Acceptance Criteria:**
- Given a pledge and a simulated payment, when the Node's webhook confirms it, then the member's card and every member's pool card show the new state from the Node, and the funding bar moves.
- Given a member who has not paid, then their state reads Waiting and no bank detail is on any screen.
- Given a delivered webhook twice, then the pool changes once.
- Given `pnpm run ci`, then it passes.

### Shortcuts

- **Retire on this story (if the work is done):** S-4.6-8 (pool timer) becomes a deliberate polling rule and is kept only if the timer stays; S-4.3-10 (status read only on open) is retired if the Pay card refreshes on the pool timer.
- **Keep, check in the demo:** S-4.3-8 (pledge limits unverified), S-4.5-10 (ledger off by default; the demo turns it on), S-4.6-6 (wording "Part paid"), S-4.3-11 (simulated completion).
- **Add:** one row per simulated step shown in the demo (the bank page is simulated; the payment does not reach a real account).

### Verification

**Commands:** `pnpm run test`, `pnpm run ci`.

**Manual, both every time:**
- Web: run `apps/shopong` in the browser with the demo Node. Pledge as two members, pay one through the simulated bank page, leave one unpaid. Screenshot the Orders card and the pool card for a paid member and an unpaid member. Confirm no account detail on screen.
- Android emulator: the same flow on Expo Go. Check the in-app browser tab returns to the app and shows the new state after "Check again". Note what was not checked (for example iPhone).

### Open Questions

**Answered 2026-10-26 by the product owner: all recommended answers accepted.**


1. **Word for an unpaid member.** The epic says "unpaid"; the code says "Waiting".
   - A) Keep "Waiting" for the pool and show "Not paid yet" on the member's own card. (Recommended: the code already uses Waiting for the pool, and the epic's word is kept for the member's own view.)
   - B) Change the pool word to "Unpaid" everywhere.
2. **Part paid.** S-4.6-6 added "Part paid", which the epic did not name.
   - A) Keep "Part paid" as a status between Waiting and Paid. (Recommended: it is the honest state for a partial payment.)
   - B) Show Waiting until the full share is paid.
3. **Funding bar scope.** The pool is per community; a pledge is per member.
   - A) One bar for the community's pool against the order's total. (Recommended: it is what the Node already reports.)
   - B) A bar per member against their share, in addition.
4. **Demo Node.** Who runs the demo Node?
   - A) The product owner's laptop, with the ledger enabled from `.env`. (Recommended for the demonstration.)
   - B) A hosted Node, which needs the secrets story (epic 12) first.
