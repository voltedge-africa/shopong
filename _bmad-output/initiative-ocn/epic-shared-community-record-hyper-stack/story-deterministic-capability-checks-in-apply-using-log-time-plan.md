---
title: 'Deterministic capability checks in `apply` using log time'
type: 'feature'
ticket: 6
created: '2026-10-26'
status: draft
baseline_revision: 'd17c46448ecff8fd7d81b796dec4c239838dbfe8'
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

**Problem:** `apply` and the phone decide role and invitation expiry with the sender's `claimedAt` (S-2.5-8, S-2.4-2, S-2.3-7), so a backdated event can use a role that has ended (S-6.8-5, S-6.8-11). A revoked capability has no effect in `apply` yet.

**Approach:** `apply` takes log time from the record itself: the highest `claimedAt` accepted so far, kept in the view, and passes it as `logTime` to the one `verifyAuthority` check. Expiry and revocation are judged at that time, so every replay gives the same result. A revoked capability is refused and written to `rejected/<id>`.

## Boundaries & Constraints

**Always:** `apply` reads only the entry and the view. Log time is a view value, updated only after an event is accepted. An event's own `claimedAt` is not used to judge that same event. Replaying the same log on any date gives the same view.

**Never:** Reading the device clock, the network or randomness in `apply`. Early revoking UI or the trustee flow (story 2.6). The Node's own clock check (story 2.5 already owns it). Changing the `SharedRecord` port.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Role in force | Log time before `expiresAt` | Applied | None |
| Role ended in log time | Log time at or after `expiresAt`, `claimedAt` backdated | Refused | `rejected/<id>`, "Your role ended on <date>." |
| Backdated claim | `claimedAt` below log time | Log time does not move back; checked at log time | As above |
| Forward jump | `claimedAt` far above log time | Per the chosen rule (Q1) | `rejected/<id>` if refused |
| Revoked capability | A `role.revoked` accepted earlier in the log | Later use refused | `rejected/<id>`, plain reason |
| Replay on another date | Same log, different wall clock | Same view | None |
| Rebuild after reorder | Same events, different Autobase order | Same view | None |

</frozen-after-approval>

## Open Questions

**Answered 2026-10-26 by the product owner: all recommended answers accepted (Q1 to Q5, option A each).**

1. **What is log time, and how is a malicious writer stopped from pushing it forward or backward?**
   - A) Log time is the highest `claimedAt` of events already accepted, held in the view. The event's own `claimedAt` counts only after its checks. A rise is capped per event (value to be chosen, for example 24 hours above the current log time); a bigger claim is refused with a reason. Going backward is impossible because log time only rises. **Recommended.**
   - B) Same, with no cap. A writer can still jump log time forward until the Node's clock check (S-2.5-3) catches it. Recorded as a shortcut.
   - C) Use the Autobase causal position instead of `claimedAt`. Deterministic, but it departs from the ticket and from AD-6.

2. **How is a revoked capability recorded?**
   - A) This story uses the existing `role.revoked` event type (listed in `registry.ts`, no payload schema, no `apply` branch). Story 2.6 owns the strict payload, who may revoke (the trustees), and the screen. This story owns only the `apply` check that reads the revocation and refuses later use. **Recommended.** Note that story 2.6 is still `draft`.
   - B) Wait for story 2.6 and build nothing here except the log-time value.
   - C) This story adds a new `revocation` event type and story 2.6 reuses it. Two event types for one thing.

3. **What happens to events already applied when a role expires in log time?**
   - A) Nothing is undone. Each event is judged at its own position in the log, so a rebuild gives the same view, and only later events are refused. **Recommended.**
   - B) Recompute the view, dropping effects of events whose authority has since ended. This breaks append-only history and is not monotonic.
   - C) Mark earlier events as "ended later" in the view without removing them. Adds state with no decision attached.

4. **How do phone and Node agree with `apply`?**
   - A) Phone, `apply` and Node all call the same `verifyAuthority` with `logTime` from their view copy. The Node also refuses if its own clock is past the role end, so a stale view cannot grant a role that has ended. **Recommended.**
   - B) The Node uses only its clock (as now, S-2.4-2); `apply` uses only log time. They can disagree, which is written down.
   - C) Everyone uses log time only, and the Node drops its clock check. A stale Node view could then accept an ended role.

5. **Which shortcut rows does this story close?**
   - A) Close S-2.5-8, S-2.4-2 (apply part), S-6.8-5 and S-6.8-11 (the `apply` part). Partly close S-2.3-7 (the phone's invitation check still uses the device clock). Touch S-2.5-7 (the phone's offline copy) and S-2.3-22 (each new refusal adds a `rejected/` row). **Recommended.**
   - B) Close none until the Node is wired (story 3.5).

## Code Map

- `packages/community/src/apply.ts` -- uses `event.claimedAt` for `isCoTreasurer`, `isTreasurer` and `joinedAt`; the entry point to change.
- `packages/community/src/authority.ts` -- `verifyAuthority` takes `request.at` and passes it as `logTime`; `isRevoked` is an optional callback. Reuse as is.
- `packages/community/src/roles.ts` -- `isCoTreasurer`, `coTreasurerJoinGrant`, `readRole` compare `at` to `expiresAt`.
- `packages/community/src/invitation.ts` -- `checkInvitation` (device clock, S-2.3-7).
- `packages/community/src/chain.ts` -- `chainLinks`, `invitePassOnAllowed`.
- `packages/community/src/refusals.ts` -- plain reasons for refusals.
- `packages/events/src/registry.ts` -- `role.revoked` in `EVENT_TYPES`; no validator yet.
- `packages/events/src/envelope.ts` -- `claimedAt` is documented as "not trusted as log time".
- `packages/record-autobase/src/record.ts` -- calls `definition.apply(entries, viewWriter(hb), host)` per entry; the log time is read and written here through the view.
- `packages/ports/src/capability-auth.ts` and `packages/ports/src/shared-record.ts` -- ports; do not change.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/community/src/apply.ts` -- keep `logTime` in the view and pass it to every role and invitation check, never `claimedAt` -- the log-time rule
- [ ] `packages/community/src/apply.ts` -- the `role.revoked` branch and the refusal of later use -- revocation in `apply`
- [ ] `packages/community/src/*.test.ts` -- replay on two dates gives the same view; backdated claim refused; revoked use refused; rebuild after reorder gives the same view
- [ ] phone and Node call sites -- pass log time from the view (Q4)
- [ ] `_bmad-output/initiative-ocn/shortcuts.md` -- update the rows in Q5, and add rows for any cap chosen in Q1

**Acceptance Criteria:**
- Given the same events replayed on two dates, then the view is identical.
- Given a backdated `claimedAt` for an ended role, then `apply` refuses it and records `rejected/<id>`.
- Given a revoked capability, then a later use is refused with a plain reason.
- Given `pnpm run ci`, then it passes.

## Implementation Notes

## Plan Change Log

## Review Triage Log

Pass 1 (one Haiku read-only reviewer, 2026-10-26). 4 high, 2 medium, 1 low.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | The record froze for good after any quiet gap of more than 24 hours (a claim over the cap was refused, and log time only moves on accepted events) | high, real | patch, **departs from the accepted plan answer Q1-A ("refused")** | Clamp instead of refuse: the event is judged at the current log time and moves log time by at most the cap; tests failed first, including "two days of silence, then an honest join"; mutation-checked. Judged times can lag real time after a long gap (S-3.6-14) |
| 2 | A revoked or replaced ancestor grant did not stop a co-treasurer's invite or quote in `apply` | high, real | patch | Both now verify the holder's token chain at log time; tests failed first |
| 3, 4 | A missing, non-integer or NaN `claimedAt` corrupted log time or made `apply` throw | high, real | patch | Refused with "This event has no valid time." before anything else; the event id computation cannot throw; replicas stay identical in any order |
| 5 | The cap is per event, not cumulative | medium | defer | S-3.6-2 |
| 6 | The first accepted event sets log time uncapped | medium | defer | S-3.6-3 (creator trusted; a wrong clock at founding skews everything after it) |
| 7 | A taken-back ancestor gave the wrong sentence | low, real | patch | "This role has been taken back."; test failed first |

## Design Notes

`apply` must not read the clock (AGENTS.md rule 3). Log time is therefore the only time it can use, and the Node's clock stays the final guard for anything with a real-world effect.

## Verification

**Commands:**
- `pnpm run ci` -- expected: exit 0, new tests included
- `pnpm --filter @shopong/community test` -- expected: replay-date, backdate and revocation tests pass

**Not verified while drafting:** no tests were run; the `apply` branch for `role.revoked` and the view key for log time were not found in the code; story 2.6's plan is still a draft; the `apps/node` call sites and the `ports-contract` files were not opened.
