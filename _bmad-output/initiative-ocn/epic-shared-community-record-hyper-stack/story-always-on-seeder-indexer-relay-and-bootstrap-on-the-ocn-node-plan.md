---
title: 'Always-on seeder, indexer, relay and bootstrap on the OCN Node'
type: 'feature'
ticket: 5
created: '2026-10-26'
status: 'draft'
baseline_revision: 'f90eea4108f3dbdcd21e090488c642995961c015'
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

**Problem:** Story 3.2 gives the Node a real record on disk, but nothing reaches it. Phones cannot append to it or read it, and the Node has no route that accepts a write. Demonstration 1 needs phones to sync with the Node when online and to keep working offline (AD-21).

**Approach:** The Node serves each community's record over an authenticated HTTPS API, with a WebSocket for live change notices. Every request carries the caller's signature, checked with the request-proof scheme from 2.5. An append is acknowledged only once the entry is durably in the Autobase on disk. The Node is the seeder (it keeps the full record) and the only indexer for Demonstration 1. Relay and bootstrap are not built here.

## Boundaries & Constraints

**Always:** Every route rejects a request without a valid signature before it reads anything. Writes go through the record's own `append`, so `apply` and the event id stay as they are. Secrets stay on the Node. New dependencies are pinned and their licence noted in the PR. Tests run in process on the record adapter.

**Never:** The phone's offline queue or "on your phone" marking (3.4). Log-time capability checks in `apply` (3.6). Writer admission or removal (3.3). Files (3.7). Hyperswarm, HyperDHT bootstrap or relay (AD-19, deferred). Any change to the `SharedRecord` port.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Signed append | Valid signature, writer admitted, new event | 200, receipt with event id, `duplicate: false`, durable | None |
| Duplicate append | Event id already in the log | 200, `duplicate: true`, nothing new | None |
| Unsigned or bad signature | Missing or wrong `x-ocn-*` headers | Refused before the record is touched | 401, audit log line |
| Not a writer | Valid signature, DID not admitted | Refused | 403 `not_writable` |
| Pull since cursor | Phone sends last seen position | Entries after it, in order | Unknown space: 404 |
| Restart | Node stopped and started | Acknowledged entries still served | None |
| Record off | Record component disabled | Routes answer 503 | Plain sentence, no crash |

## Code Map

- `apps/node/src/node.ts` -- `startNode`; opens the record and builds the app. Routes plug in here.
- `apps/node/src/app.ts` -- `buildApp`; only `/health`, `/ready` and the authority guard today.
- `apps/node/src/authority.ts` -- `createAuthorityGuard`; reads `x-ocn-actor`, `x-ocn-nonce`, `x-ocn-time`, `x-ocn-signature`; `AuthorityConfig.view` is still injected, wiring it is this story's.
- `apps/node/src/record.ts` -- `openRecordComponent`, `nodeDid`, `masterKeyOf`.
- `apps/node/src/config.ts`, `secrets.ts`, `components.ts` -- config, secrets, component list.
- `packages/record-autobase/src/record.ts` -- `openAutobaseRecord`, `AutobaseSharedRecord`.
- `packages/community/src/request-proof.ts` -- `signRequest`, `verifyRequestSignature`, `REQUEST_SKEW_MS`, `RequestHeaders`.
- `packages/ports/src/shared-record.ts` -- the port. Do not change.
- `docs/decisions/3-1-record-on-the-node.md` -- the decision this story builds on.

Not re-checked this session: the contract and memory adapter files named in the 3.2 plan.

## Tasks & Acceptance

**Execution:**
- [ ] `apps/node/src/` -- signed routes: `POST` append, `GET` pull since cursor, a WebSocket for change notices, all behind the signature check -- the sync surface
- [ ] `apps/node/src/authority.ts` -- wire the record's view into `AuthorityConfig` -- authority works on the real record
- [ ] `apps/node/src/*.test.ts` -- tests for the matrix rows, including a request with no valid proof refused
- [ ] `_bmad-output/initiative-ocn/shortcuts.md` -- rows for each choice; dependency licences in the PR

**Acceptance Criteria:**
- Given a phone with a valid identity proof, when it appends and then pulls, then it gets its entry back with the event id.
- Given a client with no valid proof, then the Node refuses it and the record is not read or written.
- Given the Node is stopped and started, then acknowledged entries are still served.
- Given `pnpm run ci`, then it passes.

## Verification

**Commands:**
- `pnpm run ci` -- expected: exit 0, new tests included
- `pnpm --filter @shopong/node test` -- expected: sync and refusal tests pass

**Manual checks (if no CLI):**
- Start the Node, append with a signed request and with an unsigned one, restart, and pull.

## Open Questions

**Answered 2026-10-26 by the product owner: all recommended answers accepted (Q1 to Q7, option A each). Epic Done-when item 5 and AD-19 are to be reworded to match Q5.**

**Q1. How does a phone connect to the Node?**
- A) Plain HTTPS for append and pull, plus a WebSocket for change notices. Works in Expo and on web with no native code. **Recommended.**
- B) Hyperswarm on the phone. Needs native code and the Hyper stack on the phone, which AD-21 defers.
- C) HTTPS polling only. Simplest, but slower to show new entries.

**Q2. How does the phone prove who it is on that connection?**
- A) Sign every HTTP request with the existing `signRequest` scheme and check it with `verifyRequestSignature`. The WebSocket upgrade is signed once and closed when the proof expires. **Recommended.**
- B) A session token after one signed handshake. Less work per request; the 2.5 nonce memory is in-process only, so this adds state to lose on restart.

**Q3. What may a phone read and write, and how are offline writes queued?**
- A) Read the whole record of any community it is a member of. Append only events whose actor is itself and whose proof is valid; `apply` still decides. Offline writes sit in device storage with their event id, sent in order on reconnect, and retried with the same id so duplicates are harmless. **Recommended.**
- B) The Node filters the view by role. More work, and the record is the same for everyone anyway.
- C) Keep the queue in memory only. Lost when the app closes, which breaks NFR1.

**Q4. What does the Node acknowledge, and when?**
- A) Acknowledge an append once the entry is durably in the Autobase on disk, with the event id and `duplicate` flag. The phone marks it saved only then. **Recommended.**
- B) Acknowledge after `update()` has applied it to the view, and return the view position. Slower, but the phone sees its effect at once.

**Q5. What do seeder, indexer, relay and bootstrap mean for Demonstration 1 and later?**
- A) Demonstration 1: the Node is the seeder (full copy, serves it while phones are off) and the only indexer. Relay and bootstrap are later. The epic's Done-when item 5 and AD-19 mention relay for NAT, so they must be reworded to match. **Recommended.** This is a conflict with the ticket's own text, not a silent pick.
- B) Also run the HyperDHT bootstrap and relay on the Node now. Adds a public network surface and needs Hyperswarm on the Node.

**Q6. Does an append at the Node also run the capability check?**
- A) No, for this story: the Node checks the signature and the record checks the capability in `apply`. Log-time checks come in 3.6. **Recommended.**
- B) Also run `verifyAuthority` at the Node before each append. Stronger, but duplicates the rule before 3.6 has settled it.

**Q7. What is left to 3.4 and 3.6?**
- A) 3.4 owns the phone's queue, retries, "on your phone" marking and reconvergence. 3.6 owns log-time expiry and revocation in `apply`. 3.5 owns only the Node's routes, the proof and the acknowledgement. **Recommended.**
- B) Move the phone-side queue into 3.5 as well.

**Unverified:** the `_bmad/render/bmad-build/*/plan-template.md` template is not in this checkout (`_bmad/render` holds only a `.gitignore`), so this plan follows the sibling 3.2 and 2.5 plans. I did not check whether Fastify's WebSocket plugin is already a dependency, and I did not run any tests.
