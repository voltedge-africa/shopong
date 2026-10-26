---
title: 'Create a community space with a deterministic view'
type: 'feature'
ticket: 2
created: '2026-10-26'
status: 'draft'
baseline_revision: '5a80af041e7192fd3a26f605519e07315486f46b'
route: 'full'
route_source: 'auto'
risk: 'high'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The community rules (`apply`) work, but only on the in-memory record, which is lost when the app closes and cannot be shared. Demonstration 1 needs a real record that the OCN Node holds on disk and that survives a restart.

**Approach:** A new package, `@shopong/record-autobase`, implements the existing `SharedRecord` port on Autobase and Hyperbee, running in the OCN Node: one Autobase per community, the community `apply` unchanged, and a map from a member's identity (DID) to their writer key kept inside the view so every replay agrees. The first task is a smoke test that the stack runs on Node 24 at all.

## Boundaries & Constraints

**Always:** `apply` stays deterministic (no clock, network or randomness) and the event id comes from `@shopong/events`. The adapter passes the port's whole contract suite, unchanged. Everything is stored on disk under the Node's data directory. Versions are pinned and each new dependency's licence is noted. Secrets stay on the Node. The port is not changed.

**Never:** The phone-to-Node connection (stories 3.4 and 3.5). Admitting or removing writers by capability (3.3). Files and Hyperdrive (3.7). Hyperswarm, relay or bootstrap. Encrypting blocks. Anything on a phone.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create | A creator and a community definition | A space whose creator is its first writer | None |
| Same events, any order | The same entries delivered in different orders to two replicas | Byte-identical views | None |
| Restart | The Node is stopped and started again | The view, the writers and every event are still there | None |
| Duplicate | An event id that is already recorded | One entry; the receipt says duplicate | None |
| Not a writer | A DID that was never admitted appends | Refused | `not_writable` |
| Unknown writer key | An entry from a key with no DID in the view | Skipped by `apply`, never applied | None |
| Clock or randomness in apply | `apply` reading the time or a random value | Impossible: a test traps both | The test fails |

</frozen-after-approval>

## Open Questions

**Answered 2026-10-26 by the product owner: all recommended answers accepted.**

1. **Which runtime runs the record?** The Hyper packages have native parts built for Bare, and nothing in the repo shows them running on Node 24.
   - A) Try Node 24 first with a smoke test; if the stack won't run, run the record service as a Bare process the Node starts and talks to locally, and write down which one worked. No product decision needed unless it fails.
   - B) Decide now to run the record as a Bare process. Matches the spike, adds a second process.
2. **Who makes each member's writer key?**
   - A) The Node derives it from its own secret and the member's DID (so a restore reproduces it) and records the DID-to-key map in the view. The Node could in principle write as any member; that trust is accepted and recorded.
   - B) The phone makes its own writer key. Needs the phone to take part in the record, which this decision (AD-21) defers.
3. **How is the data stored on disk?**
   - A) One Corestore for the Node with a namespace per community, under a data folder set in the Node's config, with its master key from the Node's secrets.
   - B) A separate store per community.
4. **Who is an indexer?**
   - A) The Node is the only indexer for Demonstration 1, which is the simplest and fits "the Node holds the writers".
   - B) Add the treasurer's device as an indexer too (needs phones in the record, so later).
5. **Is the record encrypted on disk?**
   - A) Not for Demonstration 1: members can read the record anyway and personal details are only commitments. Recorded as a shortcut.
   - B) A per-community encryption key now.
6. **Speed.** There is no throughput number (the spike's 10,000-event test timed out).
   - A) Record how long 1,000 appends and a restart take in the story, as information, not a pass/fail gate.
   - B) Set a target now (for example 100 events a second).

## Code Map

- `packages/ports/src/shared-record.ts` -- the port: `SharedRecord`, `Space`, `Apply`, `ApplyHost`, `RecordEntry { id, writer, event }`, `SpaceDefinition { apply, eventId }`. Do not change.
- `packages/ports-contract/src/shared-record.ts` -- `runSharedRecordContract(factory)` with nine cases (creator is the first writer, duplicates, ordered `list`, non-writer refused, admitted writer writes, removed writer, three writers with conflicting offline writes converging in different replication orders, `subscribe`, `close`). The adapter must pass all of them.
- `packages/adapters-memory/src/shared-record.ts` -- the behaviours to reproduce: no event id passed to `apply` twice; entries from writers not yet admitted are skipped before `apply`; `update()` rebuilds the view from empty when the order changes; `subscribe` fires once per rebuild; `list` in UTF-8 key order.
- `git show 9de4e48:spikes/3-1-bare-worklet/core/lib/space.js`, `keys.js` -- the spike's Autobase plus Hyperbee wiring, `meta/logTime`, and `viewDigest` (a canonical SHA-512 of a view, good for the order test). Bare-specific code (`bare-pack`, `bare-link`, `bare-rpc`) is not reused. Its event envelope duplicates `@shopong/events`; use the repo's.
- `packages/community/src/apply.ts`, `community.ts` (`communityDefinition`) -- runs on the Node's Autobase unchanged. It decides on `entry.writer`, which the port types as a DID, so the adapter must give it the DID, not the core key.
- `apps/node/src/` -- Fastify with `/health` and `/ready` only; `components.ts` has a stub record component. The adapter plugs in there; config and secrets come from the existing loader.
- `_bmad-output/initiative-ocn/architecture-ocn/architecture-ocn.md` section 12, "the `SharedRecord` port identifies writers by DID, while Autobase uses core keys": the map must live in the view (the admitting event carries the key; `apply` writes `writerkeys/<did>`), never in a process table.
- Pinned versions from the spike's lock: autobase 7.28.2 (Apache-2.0), corestore 7.16.1 (MIT), hypercore 11.39.3, hyperbee 2.27.3 (MIT), b4a 1.9.0, sodium-universal 5.0.1; the register and lock disagree on hypercore's licence (both permissive); record the real one in the PR.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/record-autobase/` smoke test first -- one event through Autobase and Hyperbee on Node 24, view read back -- proves the stack runs, or decides question 1
- [ ] `packages/record-autobase/src/` -- the adapter (create, open, append, update, view, writers, subscribe, close) with the DID-to-writer-key map in the view -- the real record
- [ ] `packages/record-autobase/src/*.test.ts` -- the port's contract suite, a property test that different arrival orders give byte-identical views (using `viewDigest`), a restart test, and a test that traps the clock and randomness inside `apply` -- the acceptance checks
- [ ] `apps/node/src/` -- start the adapter with the data folder and key from config, behind the record component, and report it in `/ready` -- Node wiring
- [ ] `_bmad-output/initiative-ocn/shortcuts.md` -- rows for each choice, plus the dependency licence note in the PR

**Acceptance Criteria:**
- Given the same events delivered in different orders to two replicas, then both views are byte-identical (a property test shows it).
- Given the Node is stopped and started, then the view and the writers are still there.
- Given the port's contract suite, then the adapter passes every case.
- Given `pnpm run ci`, then it passes.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Design Notes

The smoke test is the tracer: if the Hyper stack will not run on Node 24, the story's first result is that fact, and the record service moves to a Bare process (question 1) before anything else is built. The community `apply` refuses an event whose actor is not the writer; in this adapter "the writer" is the DID the writer key maps to, so that rule keeps holding.

## Verification

**Commands:**
- `pnpm run ci` -- expected: exit 0, new tests included
- `pnpm --filter @shopong/record-autobase test` -- expected: contract, order, restart and trap tests pass

**Manual checks (if no CLI):**
- Start the Node, create a community through the adapter, stop it, start it again, and read the community back.
