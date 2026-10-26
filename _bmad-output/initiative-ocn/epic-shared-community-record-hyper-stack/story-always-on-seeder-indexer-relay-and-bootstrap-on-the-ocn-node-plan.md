---
title: 'Always-on seeder, indexer, relay and bootstrap on the OCN Node'
type: 'feature'
ticket: 5
created: '2026-10-26'
status: done
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

## Plan Change Log

- 2026-10-26, product owner: the blocker (one local Autobase writer per replica, `exclusive` sessions) is resolved as **option A**. The Node keeps one Autobase replica per member, in its own store under the data folder, each opened with `open()` as that member using the derived keys and the existing API. Those replicas replicate over persistent in-process pipes into the Node's indexer replica (the seeder and only indexer). An append is acknowledged once the member replica's append is durably on disk (Q4). The `SharedRecord` port and the record adapter's exclusive-writer rule are unchanged. Costs are recorded as shortcut rows S-3.5-10 onward.
- 2026-10-26, implementation under option A: the pull reads the indexer's journal, which `apply` writes one entry per applied event (position = apply order, so replicas agree). The cursor is an opaque string (`ocn-pull/v1:<position>`, base64url). Pulls are for members only (the view's `members/<did>`). The record adapter gains three read-only functions, `journalSince`, `journalHead` and `connectSpaces`; the `SharedRecord` port and the exclusive-writer rule are unchanged. The live notice is Server-Sent Events on `GET /spaces/:key/changes`, not a WebSocket: it needs no dependency, and phones poll the pull route alone (S-3.5-4). Relay and bootstrap stay out (Q5).

## Review Triage Log

Pass 1 (one Haiku read-only reviewer, 2026-10-26). 3 high, 8 medium, 9 low.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | A stranger with a valid-looking key could use up the one-time-number table and block every member for about 4 minutes | high, real | patch | The number is claimed only after the signature, skew and admission checks; test failed first; mutation-checked |
| 2 | A stranger's first request made the Node create a record copy, folder, pipe and registry entry for them | high, real | patch | Nothing is created for anyone not admitted; 500 stranger GETs and 500 POSTs leave the folder and registry unchanged |
| 3 | Two requests at once could open the same replica twice | high, real | patch | In-flight promises are shared; test with `Promise.all` on a fresh hub |
| 4 | A failed join to the main copy left an unconnected replica | medium, real | patch | Rolled back and retried; tested |
| 5 | A member's pull straight after its own acknowledged write could miss it | medium, real | patch | Bounded wait until the indexer has applied the acknowledged ids, then `behind: true`; tested |
| 6 | Pull responses capped by count only; no body limit | medium, real | patch | 1 MiB pull cap with `more`, 64 KiB body limit (413); tested |
| 7 | No bound on what one member can write; three stored copies per event | medium, real | defer | S-3.5-16 |
| 8 | A failed start or stop could leave the record open | medium, real | patch | `closeInOrder`; tested |
| 9 | Record off should answer 503, but answered 404 | medium, real | patch | Routes always registered; tested |
| 10 | "Not a writer" had no test with the real record | medium, real | patch | Test added |
| 11 | Nothing registers a community on the Node in production | medium, real gap | defer to the product owner | S-3.5-20; needs a signed create or register route before a phone can sync |
| 12 | The query string was outside the signature | low, real | patch | Full URL signed; tested |
| 13, 14 | SSE had no per-member cap, no backpressure, and a hijack ordering bug | low, real | patch | Cap of 3, slow readers closed; the backpressure path has no test of its own |
| 15, 17, 19 | Concurrent duplicate appends; cursors past 2^53; nonce pruning assumes a monotonic clock | low | defer | S-3.5-17, S-3.5-18, S-3.5-19 |
| 16, 18, 20 | Registry fsync and validation; re-registration dropped members; comments overstated ordering | low, real | patch | Done (directory fsync still open, S-3.5-21) |
| 21 | (mutation check) the member check on the live-notice route changed no test | medium, real | patch | Stranger-on-`/changes` test added; mutation-checked |

