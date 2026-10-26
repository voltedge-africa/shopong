---
title: 'Pay my contribution by bank payment'
ticket: 3
status: 'draft'
baseline_revision: '788a54d8ab1c5cedcf4ab94ed00f62779eefa091'
---

## Intent

**Problem:** Demonstration 1 needs each member to pay their pledge into the stokvel pool by bank payment (FR9). The Stitch test client (step 1.6) is postponed (product owner, 2026-10-26), so the bank step runs on the simulated Stitch adapter from spike 4.4. Today no pledge can be paid: `pledge.created` exists only in `packages/scenario-stokvel`, and the app has no pledge or payment screen.

**Approach:** A member taps Pay on their own pledge. The phone sends a signed request to the OCN Node carrying only the pledge's event id. The Node checks the record and the member's `order/pledge` authority, creates the request through the `PayIn` port with the pledge's event id as external reference, appends `payment.requested` as the Node, and returns the bank page URL. The app opens it in an in-app browser tab (AD-15). On return the app shows "Waiting for confirmation" and asks the Node for the status. It never shows "paid" from the return link; that waits for the verified webhook in story 4.5.

## Boundaries & Constraints

**Always:** The Node creates every payment request; the phone supplies only the pledge's event id. Amounts are integer minor units (ZAR cents) end to end. The external reference is `eventIdOf(pledge)` (SHA-512 hex). Every screen and log line on this path says "test payment, no money moves" and carries `simulated: true`. Plain words only on screen: no "Stitch", "webhook", "UCAN" or "idempotency". No phone number, ID number, bank account or name in the record, the request or the logs.

**Never:** Show "paid" from a redirect parameter. Take an amount from the phone. Create a request from the bank page or the phone. Read or send Stitch credentials. Edit this plan's `status`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Pay own pledge | Pledge R150.00, Node up | One request; bank page opens; "Waiting for confirmation" | None |
| Double tap or lost reply | Same pledge sent twice | Same request id; one `payment.requested` event | None |
| Someone else's pledge | Caller is not the pledge's member | Refused | "You can only pay your own pledge." |
| No authority | Role ended or never held | Refused, nothing created | "You can't pay with this role." |
| Phone sends an amount | Amount differs from the pledge | Refused | "The amount must match your pledge." |
| Amount out of range | Under R1.00, or over R3,000 | Refused, nothing created | "The smallest payment is R1.00." / "That is more than one bank allows in one payment." |
| Return link says paid | `status=completed` in URL, Node says pending | "Waiting for confirmation" | Never "Paid" |
| Node unreachable | No network | Pledge kept | "Could not reach your community's Node. Try Pay again." |
| Request expired | Past `expireAt`, unpaid | "Not paid. The request ran out." | Pay again makes a new attempt |
| Node restarts while waiting | Request made before restart | Status still found | Depends on Open Question 7 |

## Code Map

- `packages/events/src/registry.ts` -- `pledge.created` and `payment.requested` have placeholder validators; add strict ones as `member.invited` does.
- `packages/events/src/hash.ts` -- `eventIdOf(event, sha512)` gives the external reference.
- `packages/ports/src/payments.ts` -- `PayIn`, `PaymentRequestInput`, reference length limits (12 payer, 20 beneficiary).
- `packages/ports/src/common.ts` -- `Money { currency, minor }` and `isMoney`.
- `packages/ports-contract/src/payments.ts` -- the `PayIn` cases the adapter must pass.
- `packages/adapters-memory/src/payments.ts` -- `MemoryPayIn`, the reference behaviour (same reference and body gives the same request).
- `packages/community/src/quotes.ts`, `community.ts` (the `quote.added` emit at ~line 296), `apply.ts` -- the pattern for a new record event and its `apply` check. The architecture's `pledges/<orderId>/<did>` key is not in code yet.
- `packages/community/src/roles.ts` -- `ACTIONS` has no `order/pledge` entry; `formatRand` exists.
- `apps/node/src/commitment-route.ts` -- template for a signed, role-gated route.
- `apps/node/src/signed.ts` -- `verifySignedRequest`, `claimNonce`, `SeenNonces`.
- `apps/node/src/authority.ts`, `apps/node/src/app.ts`, `apps/node/src/node.ts` -- authority guard, route registration, start-up wiring.
- `apps/node/src/components.ts`, `config.ts`, `secrets.ts` -- `payments` is off by default and requires the Stitch secrets (see 4.4).
- `apps/node/src/redact.ts` -- log redaction.
- `apps/shopong/components/CommunityCard.tsx`, `apps/shopong/app/(tabs)/settings.tsx`, `apps/shopong/lib/community.ts`, `apps/shopong/lib/CommunityProvider.tsx`.
- `miniapps/vendor/orders/src/Orders.tsx`, `miniapps/vendor/orders/src/host.ts` -- the host interface a pledge surface would extend.
- `packages/scenario-stokvel/src/node.ts` -- the existing pledge to `payment.requested` model, a test reference.
- `docs/sandbox-setup.md`, `scripts/sandbox/env.sandbox.example`.
- Not found: `apps/node/src/community-routes.ts` (named in the brief; does not exist). `expo-web-browser` is not in `apps/shopong/package.json`.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/events` -- strict validators for `pledge.created` and `payment.requested`, amounts as integer minor units -- the event shapes.
- [ ] `packages/community` -- pledge check (the actor is the member; amount rule) and the `apply` view entry -- the rules.
- [ ] `apps/node/src/` -- signed `POST /payments/requests` and `GET /payments/requests/:id` built like `commitment-route.ts`; `order/pledge` check; `payment.requested` appended as the Node; audit lines with `simulated: true`.
- [ ] `apps/shopong/` -- Pay control, a pure status-to-words mapping that never shows "Paid" from a return link, in-app browser tab. Adding `expo-web-browser` needs a PR note with its licence.
- [ ] `shortcuts.md` -- add the S-4.3 rows and name them in the PR.

**Acceptance Criteria:**
- Given my own pledge, when I tap Pay, then one request keyed by the pledge event id exists and the app opens its bank page.
- Given a double tap, then one request and one `payment.requested` event exist.
- Given a return link that says `completed`, then the app shows waiting and never paid.
- Given an amount from the phone that differs from the pledge, then the Node refuses it.
- Given a pledge under R1.00 or over R3,000, then nothing is created and the reason is plain.
- Given `pnpm run ci`, then it passes.

## Verification

**Commands:**
- `pnpm run ci` -- exit 0, new tests included.
- `pnpm --filter @shopong/node test` -- route, authority, double-tap and amount tests.

**Manual checks (both, every time, because the app changes):**
- Web: the Pay flow end to end with the simulated bank page; check the banner and the waiting text.
- Android emulator: the same flow in Expo Go, including the browser tab returning to the app.
- Not verified here: exact web and Android script names (check `apps/shopong/package.json`).

## Open Questions

**Answered 2026-10-26 by the product owner: all recommended answers accepted (first option of every question). Testing rule: any story that changes the app is checked on web AND the Android emulator, every time; any older wording that says the emulator is checked only when asked is out of date. Stitch is simulated until the product owner has the Stitch account; the simulation is labelled everywhere and recorded as shortcuts.**

1. **How is a pledge and its payment request modelled as events?**
   - A) (Recommended) The member's `pledge.created` (existing type; payload `{ order, member, amount: { currency: "ZAR", minor } }`). The Node appends `payment.requested` (existing type; `{ direction: "in", pledgeEvent, paymentId, amount }`) signed by its own DID. One envelope, existing types only. The Node DID is still a placeholder (S-3.2-13).
   - B) Keep the request only in the Node, with no event. The phone and other members cannot see "requested".
   - C) A new `payment.pending` type. Adds a second state vocabulary beside the existing types.
2. **Who triggers the request?**
   - A) (Recommended) The phone calls the signed route with the pledge id; the Node checks the record and creates it. Matches AD-3 and the "phone asks, Node acts" rule.
   - B) The Node watches the record and creates a request for every `pledge.created`. No tap needed, but a bank request appears for a pledge the member never chose to pay.
3. **Amount rules?**
   - A) (Recommended) The Node uses the pledge's amount and refuses any other. ZAR only, minimum R1.00 (100 minor), maximum R3,000 (300,000 minor, the lowest pay-by-bank limit in `sandbox-setup.md`). The limits are unverified against the bank.
   - B) Only the port's positive-integer check; limits deferred to 4.5.
4. **What goes in the payer reference (12 characters max), which the payer's statement shows?**
   - A) (Recommended) `OCN-` plus 8 hex characters from `HMAC-SHA512(COMMUNITY_SECRET, memberDid)`. Opaque, no personal data, the same for the same member.
   - B) The member's name, shortened. Personal data on a statement and in a request; breaks the commitments rule.
   - C) The order name. Identifies nobody, but does not say whose money it is.
5. **Where does Pay appear, and who creates the pledge?**
   - A) (Recommended) A pledge card on the order in the Orders miniapp, through a new `OrdersHost` method. The member creates the pledge there with an amount, then Pay appears. Minimal, and the stokvel sees the order there.
   - B) Pay on the Settings community card. Less natural for an order, and the pledge still needs a creation path.
   - C) Wait for epic 6's order flow to create pledges. Blocks 4.3 on another epic.
6. **Order of work with spike 4.4?** The 4.3 `after` list omits 4.
   - A) (Recommended) Build 4.4 (the simulated adapter) first and add `4` to 4.3's `after`.
   - B) Build 4.3 against `MemoryPayIn` and swap later. Risks shipping a flow the simulated webhook never exercised.
7. **A request made before a Node restart, while waiting?** The in-memory book loses it.
   - A) (Recommended) Persist simulated payments in the Node's data folder, written with fsync and rename as `communities.json` is. A waiting member still sees the request.
   - B) Keep it in memory and record S-4.3 rows. A member who paid after a restart sees "not found".
8. **What does the member see after the bank page is closed unpaid?**
   - A) (Recommended) "Not paid yet. Your pledge is still open," with Check again and Pay again. Pay again makes a new attempt with a new pledge event.
   - B) "Payment failed." Wrong: nothing has failed yet.

## Review Triage Log

Pass 1 (one Haiku read-only reviewer, 2026-10-26): no high findings, 6 medium, 6 low. The builder also reported that `payment.requested` was not recorded (a placeholder Node identity the record refuses). The orchestrator ran the whole flow on web and the Android emulator against a real Node.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 0 | (builder) `payment.requested` was not recorded because the Node's identity was a placeholder | real | patch | Recorded through the creator's replica with the Node's `did:key` in `by` (the pattern of 4.5 and 4.6); the request is made only after the record accepts the event; a phone's `payment.requested` is refused (`node_only`); mutation-checked |
| 1 | The 3-day window came from the member's own clock | medium, real | patch | The bank's expiry is the Node's clock plus the window, never the event's time; mutation-checked |
| 2 | A member could pay any pledge they ever made | medium, real | patch | Only the member's current pledge for the order, and no second live request; mutation-checked |
| 3 | The same payer reference in every community (linkable across communities) | medium, real | patch | Keyed per community through the real wiring; mutation-checked |
| 4 | `apply` does not check `by` equals the Node's identity | medium | defer | S-4.3-18 |
| 5 | A pledge past its window left only a Pay button that always failed | medium, real | patch | "Your pledge's time to pay has run out" with "Make a new pledge" |
| 6 | Every failed status read said "Could not reach the Node" | medium, real | patch | Mapped by failure kind (clock, not yet on the Node, busy, unreadable, unreachable) |
| 7 | The bank request could be made after the record refused the event | low, real | patch | 422 `record_refused`, nothing created; a bank failure after a good record write is said plainly and a retry reuses the event; mutation-checked |
| 8, 9, 12 | Status reads not rate limited; an unknown status word showed a spinner for ever; a double tap could open two tabs | low, real | patch | Tested |
| 10 | The bank page's id sits in the in-app browser's history on a shared phone | low | defer | S-4.3-17 |

