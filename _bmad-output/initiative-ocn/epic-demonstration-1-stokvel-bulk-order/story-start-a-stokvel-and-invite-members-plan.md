---
title: 'Start a stokvel and invite members'
type: 'feature'
ticket: 1
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

**Problem:** A stokvel treasurer needs a shared place for the stokvel, with its name and the people in it, that every member sees the same way. Today the name is kept only on the creator's phone, the creator's offline changes sync through a queue, and no member can see who holds which role unless they read the record themselves.

**Approach:** Use what exists: create the community on the OCN Node, invite members by their pasted identity, and give roles with an end date. Add the missing piece: the community name (and a short plain-text rules note) written as one event, so every member sees the same name. Prove the join between two real devices, not only in tests.

## Boundaries & Constraints

**Always:** Only the creator (or a co-treasurer in force) may invite. Every change is one event in the one envelope (AGENTS rule 2). `apply` stays deterministic: no clock, no network (rule 3). Names and rules are plain text, no phone numbers or ID numbers (rule 6). Words shown to people are plain language.

**Never:** An approvals count in this story (it belongs with the pool rule, story 4.7). Payments, orders or quotes. Storing an identity in plain text in the name or rules event.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create a stokvel | A name and a rules note, online | Creator is the treasurer; name appears on all members' phones | None |
| Empty name | No name | Refused | "Give your community a name." (existing) |
| Too many communities | Creator already has 3 on this Node | Refused | "community_limit" plain sentence (existing, `community-routes.ts`) |
| No connection at creation | Phone offline, creating | Refused until a connection exists | Plain sentence; nothing queued (S-3.4-2) |
| Invite a member | Creator pastes the newcomer's identity | `member.invited` sent; invitation lasts 7 days | Invalid identity refused, plain reason |
| Join | Newcomer opens the invitation | Newcomer shown as a member on every phone | Expired or used invitation refused (existing) |
| Give a role | Creator gives co-treasurer for 30 days | Role shows with its end date to all members | Days not in 7/30/90 refused (existing) |
| Offline invite | Creator invites while offline | Queued, sent when online, shown when it lands | "Waiting to send" until then (existing outbox) |
| Replay | Same event id again | One member, one name | Duplicate receipt |

## Code Map

- `apps/node/src/community-routes.ts` -- `POST /communities` (key only; limit 3), `POST /communities/:key/members`.
- `apps/shopong/lib/CommunityProvider.tsx` -- create, invite (~364), member list (~286), offline queue use.
- `apps/shopong/lib/communityEvents.ts` -- `founderEvent`, `inviteEvent`, `joinEvent`: the pattern for new builders.
- `apps/shopong/components/CommunityCard.tsx` -- create form, invite field, "Your role" line.
- `packages/community/src/community.ts` -- `createCommunity`, `wrap` (name kept locally, ~253-260), EMPTY_NAME_MESSAGE.
- `packages/community/src/apply.ts` -- `CHECKED` (116-129), member and role handlers; add the new name event here.
- `packages/events/src/registry.ts` -- event type list (1-30); strict validators (362-373). Add the new type and its validator.
- `packages/community/src/invitation.ts`, `roles.ts` -- 7-day invitation, role list, day options.
- `apps/shopong/lib/offlineQueue.ts`, `queueStore.ts` -- outbox.
- `apps/node/src/sync.ts` -- pull and push the queue.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/events/src/registry.ts` -- a `community.named` event type (payload: name, rules; plain text, length-limited) with a strict validator.
- [ ] `packages/community/src/apply.ts` -- handle `community.named` by creator (or co-treasurer in force at log time); store `community/name` and `community/rules` in the view; refuse a second naming with a plain reason or let the latest win (per Q1).
- [ ] `packages/community/src/community.test.ts` -- name and rules shown to a second replica; empty name refused; non-creator refused; phone numbers refused.
- [ ] `apps/shopong/lib/communityEvents.ts` and `CommunityProvider.tsx` -- write the name event after create; show the name to joiners (closes S-2.3-14).
- [ ] `apps/shopong/components/CommunityCard.tsx` -- show each member's role and its end date to all members.
- [ ] A two-device join check, documented in the PR (Q4).
- [ ] `_bmad-output/initiative-ocn/shortcuts.md` -- close S-3.4-1 and S-2.3-14; add rows for anything new.

**Acceptance Criteria:**
- Given a treasurer creates a stokvel with a name, when a second phone joins by invitation, then both phones show the same name and the same members with their roles.
- Given the creator is offline and invites a member, when the phone reconnects, then the invitation is sent once and the member appears on every phone.

## Implementation Notes

- The community name is in no event today (S-3.4-1). Adding `community.named` is a new event type, not a second envelope.
- Creation needs the Node (S-3.4-2). The "offline changes sync" part of the epic's verify applies to invitations and roles.
- Real two-phone join is not proven yet (S-2.3-3, S-2.5-11). Tests simulate it.

## Plan Change Log

- 2026-10-26: Refreshed after merge of stories 2.3, 2.4, 3.2, 3.4 (`CommunityCard.tsx`, `community-routes.ts` now exist). Removed the "approvals setting" and "rules" claims, which are not in code.

## Review Triage Log

(none yet)

## Open Questions

**Answered 2026-10-26 by the product owner: all recommended answers accepted.**


1. **Name and rules in the record.** A) Yes: a `community.named` event (name plus a short plain-text rules note, up to 500 characters), written by the creator on creation, shown to all members. Closes S-3.4-1 and S-2.3-14. (recommended) B) Keep the name on the creator's phone only, as now.
2. **Approvals setting (1 to 5).** Not in code. A) Not in 8.1; the number of approvers is set with the pool rule in story 4.7. (recommended) B) Add a number to creation now, default 1, stored in the naming event.
3. **Creating while offline.** Creation is refused offline today (S-3.4-2). A) Keep creation online-only; the verify's "offline changes sync" covers invitations and roles. (recommended) B) Queue creation as well (a change to 3.4).
4. **Proof of a join.** A) A real join between two devices (for example Android emulator plus web), recorded in the PR; S-2.3-3 closed by that check. (recommended) B) Accept the in-memory tests and leave S-2.3-3 open.
5. **Who sees roles.** A) Every member sees each member's role and end date. (recommended) B) Only the treasurer sees roles.

## Verification

**Commands:**
- `pnpm exec vp test run packages/community apps/shopong` -- expected: all pass
- `pnpm run ci` -- expected: passes

**Manual checks:**
- Web: create a stokvel, name it, invite a second identity, give a co-treasurer role; check the name and roles on the second view.
- Android emulator: the same, plus airplane mode on the creator's phone during an invitation, then reconnect and check it is sent once.
- Not yet checked: iPhone, low-end Android, a real second phone (S-2.1-1, S-2.3-19).

**Shortcuts to close:** S-3.4-1, S-2.3-14. **Shortcuts this story must keep or re-state:** S-2.3-3, S-3.4-2, S-2.3-5 (7-day fixed invitation).

</frozen-after-approval>
