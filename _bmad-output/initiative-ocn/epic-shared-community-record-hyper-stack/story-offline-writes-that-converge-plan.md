---
title: 'Offline writes that converge'
type: 'feature'
ticket: 4
created: '2026-10-26'
status: 'draft'
baseline_revision: 'dc5111790034a3a152a9ef8d55f5ef88a1be9d89'
route: 'full'
route_source: 'auto'
risk: 'high'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: []
---

## Intent

**Problem:** A member on a phone with poor signal must be able to record an action and keep working, and the group must see it once the phone reaches the OCN Node. Today the app has no Node client, no offline queue, no Node address, and no way to register a community on the Node, so no real phone can use the 3.5 routes (S-3.5-20).

**Approach:** The phone keeps each event it writes in a local queue, keyed by event id, and sends the queue in order to `POST /spaces/:key/events` when the Node is reachable. Retries reuse the event id, so a duplicate is harmless. The phone pulls `GET /spaces/:key/events` with the opaque cursor and marks an event confirmed only when the Node returns it. This story also adds the signed routes that create a community and admit an invited member on the Node, with a cap on communities per person, and the phone code that calls them.

## Boundaries & Constraints

**Always:** Every request is signed with `signRequest`, and the Node checks the signature before it reads the body. The queue holds only envelopes, which carry commitments and no PII (AGENTS rule 6). The event id is SHA-512 of the canonical JSON and is the retry key. `apply` is not changed. Every phone-side adapter passes the queue's contract suite, including the in-memory one. The app holds the Node address and no secret.

**Never:** The on-phone Bare worklet or any Hyper stack on a phone (AD-21, decision 3.1). Bluetooth or nearby sync (spike 3.9). Direct phone-to-phone sync. Log-time capability checks (3.6). Writer removal (3.3). Files (3.7). Any change to the `SharedRecord` port. A secret in the app or in the queue.

**Dependencies:** Needs 3.5 merged (PR #30 is not in this checkout). Needs 3.3 so `member.joined` admits a writer in `apply`; until then a joiner's append is refused `not_writable`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Offline write | No route to the Node | Event queued on the phone, shown "on your phone" | None |
| Reconnect | Queue holds N events | Sent in order; each acknowledged and removed | Retry, same id, backoff |
| Retry after lost reply | Node stored it, reply lost | Second send returns `duplicate: true`; removed | None |
| Two phones diverge | Both append offline | Both reach the Node; views equal after pull | None |
| Cursor | Phone stores `next` | Next pull uses `after=next` | `behind: true`: pull again |
| Not a member | Valid signature, not admitted | Refused | 403, plain text |
| Cap reached | Creator already has the cap | Refused | 403 `community_limit` |
| Bad invitation | Expired, used, or forged | Member not admitted | 403, reason shown |
| Node down | Connection refused or timeout | Stays queued; offline notice | Backoff capped |
| Queue unreadable | Stored file corrupt | Nothing sent from it; kept for inspection | Plain message |

## Code Map

- `apps/shopong/lib/community.ts` -- `createCommunityService`; in-memory record network today.
- `apps/shopong/lib/CommunityProvider.tsx` -- screens' community state; sync state goes here.
- `apps/shopong/lib/identityStore.ts` -- SecureStore on native, memory on web.
- `apps/shopong/lib/identity.ts`, `identitySeed.ts`, `IdentityProvider.tsx` -- the signer.
- `apps/shopong/app/create.tsx`, `apps/shopong/app/join.tsx` -- create and join screens.
- `packages/community/src/community.ts` -- `createCommunity`, `joinCommunity`.
- `packages/community/src/invitation.ts` -- `checkInvitation`.
- `packages/community/src/request-proof.ts` -- `signRequest`, `verifyRequestSignature`.
- `packages/events/src/envelope.ts`, `packages/events/src/hash.ts` -- envelope, `eventIdOf`, `webCryptoSha512`.
- `packages/ports/src/shared-record.ts` -- the port (do not change).
- `packages/adapters-memory/src/shared-record.ts`, `packages/record-autobase/src/record.ts` -- record adapters.
- `apps/node/src/app.ts`, `node.ts`, `config.ts`, `record.ts`, `authority.ts`, `apps/node/.env.example`.
- Story 3.5 files, on branch `story/3-5-node-serves-the-record` and not in this checkout: `apps/node/src/sync.ts`, `hub.ts` (`admitMember`, `register`), `signed.ts`.

## Tasks & Acceptance

**Execution (assumes the recommended answers below):**
- [ ] `apps/node/src/` -- signed `POST /communities` (create, register creator, cap) and `POST /communities/:key/members` (checked invitation, then `hub.admitMember`).
- [ ] `apps/shopong/lib/nodeClient.ts` -- signed client; address from config; timeouts; typed errors.
- [ ] `apps/shopong/lib/offlineQueue.ts` -- queue port, memory and device adapters, one contract suite.
- [ ] `apps/shopong/lib/sync.ts` -- in-order send with retry, pull with cursor, `behind` handling.
- [ ] `CommunityProvider.tsx`, create and join screens -- "on your phone" and "saved on the Node" marks; offline notice.
- [ ] Tests for every matrix row; two simulated phones diverge offline and reconverge (fixed seeds).
- [ ] `_bmad-output/initiative-ocn/shortcuts.md` -- S-3.4-* rows; new dependency licences in the PR.

**Acceptance Criteria:**
- Given a phone writes offline, when it reconnects, then every queued event reaches the Node once, with none lost.
- Given two phones diverge offline, when both sync, then both show the same view.
- Given an event the group has not yet seen, then it shows "on your phone" until the Node returns it.
- Given a person at the cap, when they create a community, then the Node refuses with a plain reason.
- Given `pnpm run ci`, then it passes.

## Verification

**Commands:** `pnpm run ci`; `pnpm --filter @shopong/node test`; `pnpm --filter @shopong/shopong test`.

**Web:** run the Node and the web app; write offline (DevTools offline mode), reconnect, and confirm the queue drains and the mark changes. The web queue is memory only, so a reload loses it; confirm the notice says so.

**Android emulator:** run with the Node on the host at the emulator's address (`10.0.2.2`, not `localhost`); airplane mode, write, reconnect, confirm no duplicates, and confirm the queue survives an app restart. Run every time (product owner rule of 2026-10-26).

## Open Questions

**Answered 2026-10-26 by the product owner: all recommended answers accepted (Q1 to Q10, option A each).**

**Testing rule (product owner, 2026-10-26):** this story changes the app, so it is checked on web AND on the Android emulator, every time. Any earlier wording here that says the emulator is checked only when asked is out of date.

**Q1. Where does the phone's offline queue live?**
- A) Native: one JSON file in the app's private storage (`expo-file-system`, MIT, new dependency), written atomically. Web: memory only. **Recommended.**
- B) `@react-native-async-storage/async-storage` (MIT, new dependency) on native, `localStorage` on web.
- C) Memory only. Lost when the app closes, which breaks NFR1.

**Q2. What are the retry and idempotency rules?**
- A) Same event id and same envelope bytes on every retry; a fresh request nonce and time per HTTP call; in-order retry with capped backoff; a 200 clears the item whatever `duplicate` says; other 4xx are parked and shown, not retried forever. **Recommended.**
- B) Retry forever with no backoff.

**Q3. How is "on your phone" separated from confirmed?**
- A) Queued or in flight: "On your phone". Acknowledged by the Node (3.5 Q4): "Saved on the Node". Returned by a pull: "Confirmed", and the "on your phone" mark goes. **Recommended.**
- B) "On your phone" until a second member's phone has pulled it. Needs a new "seen" event, so a new story.

**Q4. How does the phone learn the Node's address, and how is it set?**
- A) A build-time value, `EXPO_PUBLIC_OCN_NODE_URL`, per build profile. The Android emulator uses `10.0.2.2`. HTTPS outside local development. **Recommended.**
- B) A settings screen where the person types it, stored outside the keystore.
- C) A constant in the code.

**Q5. How does the phone show being offline?**
- A) `@react-native-community/netinfo` (MIT, new dependency) as a hint, with the last sync result as the truth: "You are offline. Your changes are saved on your phone." **Recommended.**
- B) No new dependency: only the last sync result and a retry button.
- C) `navigator.onLine` on web only.

**Q6. How is the creator's community registered on the Node?**
- A) Signed `POST /communities` with the creator's DID. The Node creates the space on its record, registers the creator, and returns the key. The phone then sends the founding `member.joined` through the events route. **Recommended.**
- B) As A, but the Node generates the community key and the phone adopts it.

**Q7. Who may register a community?**
- A) Any person whose signed request proves a DID, with no approval step, limited by Q8. **Recommended.**
- B) Only an invited person, through an invitation chain from an existing member.

**Q8. What is the cap on communities per person?**
- A) Three communities created per creator DID, counted from the Node's registry. A fourth is refused with `community_limit`. **Recommended.**
- B) One.
- C) Ten.

**Q9. How are invited members admitted on the Node when they join?**
- A) Signed `POST /communities/:key/members` with the invitation text. The Node runs `checkInvitation` against its own view, then `hub.admitMember`. The phone then sends `member.joined` through the events route, which 3.3's `apply` admits as a writer. **Recommended.**
- B) Admit any DID whose first `member.joined` carries a valid invitation, with no separate route.
- C) The creator's phone approves each join by hand.

**Q10. Does the phone run `apply` on pulled entries, or show the Node's order as it is?**
- A) Run the same `apply` in memory on the phone over the pulled entries, so both phones show one view and the convergence test covers the phone too. **Recommended.**
- B) Show the Node's order without running `apply`.

**Not verified:** I did not read PR #30 and did not call `gh`. I read the 3.5 plan's Plan Change Log and its S-3.5-* rows from the local branch `story/3-5-node-serves-the-record` with `git show`, not from this checkout; the draft 3.5 plan in this checkout has no change log. The HEAD commit says S-3.5-20 was folded into story 3.4, but that text is not in the 3.6 plan in this checkout. Nothing was run, and no phone build was tried. I did not check whether the Node sends CORS headers for web.

## Review Triage Log

Pass 1 (one Haiku read-only reviewer, 2026-10-26). 2 high, 6 medium, 9 low. The orchestrator also ran the real thing end to end (a real Node, the web app and the Android emulator): create a community, go offline, make a change, bring the Node back, and watch it converge.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| N1 | Unlimited identities could fill the Node's disk and memory (the cap was per creator) | high, real | patch | Global cap (default 50) and an optional allow-list of creators, checked before the one-time number is claimed and before any store opens; tests failed first; mutation-checked |
| N2 | The one-time-number table could be filled so every create returned 429 | medium, real | patch | Own table per route; the allow-list keeps strangers out first |
| N3, N4, N5 | Replayed admission requests still pay the full check; admission does not record the invitation as used; community key squatting before the creator registers | low | defer | S-3.4-20, S-3.4-21, S-3.4-22 |
| P1 | A lost update in the offline queue (add and remove interleaving) could drop a change | high, real | patch | Every queue operation runs through one chain; a 1000-interleaving test failed first; mutation-checked |
| P2 | A refused item was re-sent every 5 seconds for ever | medium, real | patch | Parked until Try again or Remove this change |
| P3 | Join and create ignored a failed enqueue and still said "on your phone" | medium, real | patch | Plain failure message; tested |
| P4 | Pulled entries were trusted and "Confirmed" was given for any id | medium, real | patch | Id, community and writer are checked and bad entries counted; mutation-checked |
| P5 | One outbox file shared by every identity on the device | medium, latent | patch | Outbox named by the identity |
| P6 | One unreadable entry blocked all future writes | medium, real | patch | The file is set aside and a fresh queue starts, with a plain message |
| P7 | A clock-skew refusal parked the change | low, real | patch | Own kind, retried, "Check your phone's clock." |
| P8, P9, P10 | Backoff reset by a good pull; network-change retries bypassed backoff; plain http accepted in release builds | low, real | patch | Tested |
| P11, P12 | No size cap on Node responses; the invitation token is in the queue file in plain text | low | defer | S-3.4-23, S-3.4-24 |

