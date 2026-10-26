---
title: 'Proof of delivery and proof of collection'
type: 'feature'
ticket: 6
created: '2026-10-26'
status: 'draft'
baseline_revision: '2d1ef5d846450eee09b35853682df06a69a0c175'
---

## Intent

**Problem:** A delivered order has no signed record of arrival, and no member's collection is recorded. `delivery/confirm` is a name only (shortcut S-2.4-5). `delivery.confirmed` and `collection.confirmed` are listed in the registry, but `apply` does not check them.

**Approach:** The assigned driver signs `delivery.confirmed` with a coarse place, a time and the SHA-512 of a photo held in Hyperdrive (3.7). Each member signs `collection.confirmed` for their own share. `apply` checks both, and the order view counts progress. A dispute is a new event beside the confirmation; it never edits it.

## Boundaries & Constraints

**Always:** Exact GPS never enters the record, the Node's logs or a payload. Photo bytes stay in Hyperdrive, and location metadata (EXIF) is stripped on the device before hashing. The actor signs; `apply` judges the driver role at log time (story 3.6). Confirmations are append-only. Refusals are plain sentences.

**Never:** Releasing the pool or paying anyone (4.7). Late, failed or partial exceptions (7.7). Confirming a collection for another member. Editing or deleting a confirmation.

**Needs from parallel plans:** 3.7 (file reference shape: drive key, path, SHA-512; lazy fetch states; `clear(path)`). 7.4 (`delivery.planned` names the order, the driver and the place ids). `packages/events/src/hash.ts` `verifyAttachment` is reused as is.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Arrival confirmed | Assigned driver, current role, photo hash | `delivery.confirmed` recorded; order shows arrived | None |
| Wrong driver | Driver not the one named | Refused | "Only the assigned driver can confirm this delivery." |
| Role ended | Driver role past its end at log time | Refused | "Your driver role ended on <date>." |
| Collection confirmed | Member of the order, own share | `collection.confirmed`; progress n of N | None |
| Someone else's collection | Actor is not the member named | Refused | "Only a member can confirm their own collection." |
| Confirmed twice | Same member, same order | Second refused | "Already confirmed." |
| Photo not yet synced | Event arrives, file not on the Node | Recorded; photo shows as not yet checked | `cannot_check` message |
| Photo differs | Fetched bytes hash to another value | Shown on the order | "does not match" |
| Exact location sent | Place string with seven or more digits | Refused, nothing stored | `PERSONAL_DATA_MESSAGE` |
| Offline arrival | No network at arrival | Queued, recorded later; log time decides | None |
| Dispute | Member says a share did not arrive | `delivery.disputed` beside the confirmation | "Ama says 2 of 10 bags did not arrive." |

## Code Map

- `packages/events/src/registry.ts` -- `delivery.confirmed`, `collection.confirmed` listed; validators are `anyObject`.
- `packages/events/src/hash.ts` -- `verifyAttachment`, `ATTACHMENT_MESSAGES`.
- `packages/events/src/personal.ts` -- refuses seven-digit strings and field names such as `cell`. Numbers are not shape-checked, so rounding is our rule, not the guard's.
- `packages/community/src/roles.ts` -- `ROLES.driver`, `ACTIONS` (`delivery/confirm`), `checkAction`, `isCurrentGrantIn`.
- `packages/community/src/apply.ts` -- `CHECKED` omits `delivery.*` and `collection.confirmed`; add them, as `quote.added` is.
- `packages/community/src/log-time.ts` -- `logTimeOf`, `advanceLogTime`.
- `packages/community/src/refusals.ts` -- the phone's refusal log.
- `apps/node/src/sync.ts` -- `POST /spaces/:key/events`; the route accepts these types today.
- `packages/scenario-stokvel/src/steps.ts` -- `role.granted` driver pattern to reuse; no proof step exists.
- `_bmad-output/initiative-ocn/shortcuts.md` -- S-2.4-5 names delivery and should be closed here. It names "epic 5"; delivery is epic 7.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/events/` -- strict validators for `delivery.confirmed` (order, delivery, coarse place, time, photo SHA-512 and file reference), `collection.confirmed` (order, delivery) and `delivery.disputed` (per Q4).
- [ ] `packages/community/` -- `apply` checks: assigned driver, role at log time, member's own collection, order membership, no second confirmation; progress view per order.
- [ ] `apps/shopong/` -- driver "Confirm arrival" (photo, coarse place rounded on device, queued offline); member "I have collected"; progress on the order; dispute button.
- [ ] `_bmad-output/initiative-ocn/shortcuts.md` -- close S-2.4-5; add rows for what is left.

**Acceptance Criteria:**
- Given the assigned driver with a current role, when they confirm with a photo hash, then `delivery.confirmed` is recorded and the order shows arrived.
- Given member B confirming member A's collection, then it is refused.
- Given every member's `collection.confirmed`, then the order shows N of N collected.
- Given no network at arrival, then the confirmation is recorded once online, judged at log time.
- Given an exact coordinate, then it is refused and nothing is stored.
- Given `pnpm run ci`, then it passes.

## Verification

**Commands:** `pnpm exec vp test run packages/community packages/events`; `pnpm --filter @shopong/node test`; `pnpm run ci`.

**Manual:** on the web console and on the Android emulator, both every time: confirm arrival with a photo, check the photo's location metadata is gone, confirm a collection, then put the emulator in airplane mode, confirm, and reconnect to see it converge.

## Open Questions

**Answered 2026-10-26 by the product owner: all recommended answers accepted (the first option of every question). Testing rule: any story that changes the app is checked on web AND the Android emulator, every time; older wording that says the emulator is checked only when asked is out of date. Routes are computed off the phone (docs/decisions/7-1-valhalla-on-device.md). Photos: all metadata is stripped. The tile region is the KwaZulu-Natal extract; the ODbL share-alike position needs a lawyer's confirmation before the first public release.**

1. **Does 7.6 wait for 4.7?** The ticket lists it, but proof is what the pool would consume, which the epic notes flag.
   - A) (Recommended) Drop 4.7 from the `after` list. Proof is recorded whatever the pool does; the user confirms the direction.
   - B) Keep 4.7 as a prerequisite, as the ticket says.
2. **Which role may confirm arrival?**
   - A) (Recommended) Only the driver named on `delivery.planned`, with a current driver role at log time.
   - B) Any current driver in the community.
   - C) A treasurer too, when the driver cannot.
3. **How precise is the recorded place?**
   - A) (Recommended) Latitude and longitude to two decimal places (about 1 km), rounded on the device, as JSON numbers. A test checks nothing finer is accepted.
   - B) A named collection point id only, with no coordinates.
4. **How are disputes handled?**
   - A) (Recommended) A new `delivery.disputed` event by a member, shown beside the confirmation to the treasurer and approvers. The confirmation stays; the answer is a later event. Coordinate with 7.7, which owns exceptions.
   - B) Only 7.7's exception event, and this story adds no type.
   - C) No disputes in Demonstration 1; the treasurer is told by message.
5. **Who strips the photo's location metadata?**
   - A) (Recommended) This story strips it on the device before the photo goes to 3.7, and the test inspects the bytes.
   - B) 3.7's attach path strips it for every file. Needs 3.7's plan to say so.
6. **Can a treasurer confirm a collection for a member without a phone?**
   - A) (Recommended) No. Only the member signs their own; a treasurer may raise a dispute.
   - B) Yes, with a reason written in the event, visible to all.
