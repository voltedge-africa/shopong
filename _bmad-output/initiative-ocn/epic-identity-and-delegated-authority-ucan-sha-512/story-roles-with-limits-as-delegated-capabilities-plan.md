---
title: 'Roles with limits as delegated capabilities'
type: 'feature'
ticket: 4
created: '2026-10-26'
status: 'built'
baseline_revision: '859dc6c8b42f4a81411445c79de6d7e84daf56c3'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Only the creator can invite or act for a community (shortcut S-2.3-9). A stokvel needs a co-treasurer who can approve payments up to a limit, a driver who can confirm deliveries, and a supplier who can offer quotes, each for a limited time, and none of them able to give away more than they hold.

**Approach:** A role is a signed capability the creator (or a holder, within what they hold) gives to one person for a set time, with an optional rand limit. It is recorded as a `role.granted` event, checked with `CapabilityAuth.verify`, and refused with a plain reason when the limit, the scope or the time is exceeded. The port already enforces "lower or equal"; this story adds the roles, the recording, the reasons and the screens.

## Boundaries & Constraints

**Always:** Use `Capability.ceiling` and `capabilityCovers` for limits; check roles with `CapabilityAuth.verify` against the creator's DID and an explicit time. Keep `apply` deterministic and require `entry.writer === event.actor` (the review fix). Plain-language refusals. No new third-party dependency. Nothing outside `packages/adapter-ucan-iso` imports `iso-ucan`.

**Never:** Revoking a role early (story 2.6). Checking limits against the ledger, or moving any money (epic 4). Verifying authority at the Node (2.5). Changing the `CapabilityAuth` port. A `member/join` invitation that can be passed on (S-2.3-24 stays closed).

**Decisions (product owner, 2026-10-26, "all recommended"):**
1. A limit is a cap on each action (the port's model); a budget over a period waits for the ledger (epic 4).
2. The creator can give roles, and a holder can pass on a lower or narrower share of what they hold; the port refuses more.
3. A fixed role list: co-treasurer (`payment/approve` up to a limit, and inviting members), driver (`delivery/confirm`), supplier (`quote/offer`). The payment, delivery and quote abilities are names until their epics.
4. The treasurer picks 7, 30 or 90 days; the default is 30.
5. The end time is enforced on the device and in `apply` using the event's time, and is advisory until the OCN Node checks it with its own clock (story 2.5). Recorded as a shortcut.
6. No early revoking in this story; a role ends at its end time (revoking is story 2.6).
Every shortcut these choices take goes in `_bmad-output/initiative-ocn/shortcuts.md`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Grant | Treasurer gives a person a role, a limit and a length | Role recorded; the person sees their role and its end date | None |
| Within limit | Holder acts at or under their limit | Allowed | None |
| Over the limit | Holder acts above their limit | Refused | "That is above your limit of R<amount>." |
| Outside the role | Holder acts on something the role doesn't cover | Refused | "Your role doesn't cover that." |
| Ended | Role past its end time | Refused | "Your role ended on <date>." |
| Pass on lower | Holder gives someone a lower limit or a narrower role | Accepted | None |
| Pass on higher | Holder gives more than they hold | Refused at once | "You can't give more than you have." |
| Not allowed to grant | Someone who may not give roles gives one | Refused | "You can't give roles in this community." |
| Not a member | The person is not a member yet | Refused | "Invite them to the community first." |
| Give to yourself | The treasurer gives themselves a role | Refused | "You already hold every role." |
| Second grant | The same person, the same role again | The newer one replaces the older | None |
| Ended earlier in the chain | A link above the holder has ended | Refused | "Your role ended on <date>." |
| Unreadable | Tampered or other community's role | Refused | "This role can't be checked." |

</frozen-after-approval>

## Code Map

- `packages/ports/src/capability-auth.ts` -- `Capability` (`with`, `can`, `ceiling`), `capabilityCovers`, `verify` (takes a log time and an `isRevoked`). Do not change the port.
- `packages/ports-contract/src/capability-auth.ts` -- contract cases already cover lower-accepted, higher/wider/longer refused, expiry, revocation. Missing case: a request with no ceiling against a grant that has one; add it.
- `packages/adapter-ucan-iso/src/adapter.ts` -- maps ceiling and resource to UCAN policy; refuses amplifying delegation at issue. Reuse as is.
- `packages/events/src/registry.ts` -- `role.granted` and `role.revoked` are names only; `role.granted` needs a required-field payload (like `member.invited`).
- `packages/community/src/apply.ts`, `community.ts`, `invitation.ts` -- model for a `role.granted` branch, `issue...`, `check...` and `problemOf`-style plain reasons. `problemOf` maps only `expired` and `wrong_audience` today; roles need their own reason map (over limit, outside role, ended, unreadable).
- `apps/shopong/lib/community.ts`, `CommunityProvider.tsx`, `components/CommunityCard.tsx` -- where a grant action, "Your role" and the refusal copy go.
- `_bmad-output/initiative-ocn/shortcuts.md` -- S-2.3-9 (no roles) is closed by this story; S-2.3-24 (re-delegable join token) needs a decision in the plan: keep `member/join` out of role chains.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/events/src/registry.ts` and its test -- required-field `role.granted` payload -- replaces the placeholder
- [ ] `packages/ports-contract/src/capability-auth.ts` -- add the no-ceiling-against-a-ceiling case -- closes the contract gap
- [ ] `packages/community/src/roles.ts` and tests -- the role list, issue a role, check an action with plain reasons, a `role.granted` branch in `apply` -- the rules, tested with simulated phones
- [ ] `apps/shopong/lib/community.ts`, `CommunityProvider.tsx`, `components/CommunityCard.tsx` -- grant a role, show "Your role", and a "What can I do?" check where a holder picks an ability and an amount and sees allowed or the plain reason -- the user-facing part, and the only way to try a refusal before the payment and delivery epics exist
- [ ] `_bmad-output/initiative-ocn/shortcuts.md` -- close S-2.3-9, add rows for this story's choices

**Acceptance Criteria:**
- Given a treasurer, when they give a person a role with a limit and a length, then the person sees the role and its end date.
- Given a holder, when they act above their limit, outside their role, or after it ended, then they are refused with the plain reason in the matrix.
- Given a holder, when they pass on a lower share it is accepted, and when they pass on more it is refused.
- Given a role, when I try an action in "What can I do?", then it says allowed, or gives the plain reason.
- Given `pnpm run ci`, then it passes.

## Implementation Notes

## Plan Change Log

## Review Triage Log

Pass 1 (quick lens, one Haiku reviewer; a second reviewer on an opencode model timed out with no findings). 9 findings: 0 high, 5 low or medium patched, 4 rejected or deferred.

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Role refusals in `apply` use the invitation sentence, not "This role can't be checked." | medium | patch | Real: `recordRoleGrant` returned `INVITATION_MESSAGES.unreadable`, and the tests locked it in. Fixed to the role sentence. |
| Payload `expiresAt` vs token expiry, the token-issuer vs actor check, and the ceiling-consistency check have no tests that fail if deleted | medium | patch | Real gap: the checks exist but nothing exercised them. Four tests added; each check was removed in turn and its test failed. |
| Only the first capability of a role token is checked | low | patch | The UCAN adapter only makes one-capability tokens, so not reachable today; a one-line defensive refusal added. |
| "What can I do?" says Allowed for inviting through a second co-treasurer, but the invitation is refused (two-link limit) | medium | patch | Real inconsistency. `checkAction` now refuses unless the member/join grant is a direct creator grant; test added; recorded as S-2.4-17. |
| Lint: floating promise in the grant handler | low | patch | Fixed with `void`. |
| A superseded higher grant still passes on; any holder can replace another's recorded role | medium | defer | Real, and inherent until revocation (2.6) and the Node's check against the current record (2.5). Recorded as S-2.4-15 and S-2.4-16. |
| The grantee never sees their role in the app (no real join between phones) | low | rejected | Known: S-2.3-3 and S-2.4-12; the tests simulate phones. |
| Pass-on refusals cannot be tried from the screens | low | rejected | Known: only the creator sees the grant form (S-2.4-12). |
| "Say how much" is returned before the other reasons | low | rejected | Harmless: the screen asks for the amount before it checks. |

Also checked by hand: the pass-on rule (S-2.3-24) switched off makes three tests fail; on web, the community card shows the grant form, "Invite them to the community first", "You already hold every role" and "Your role doesn't cover that" for the matrix rows reachable on one device; console clean. Not run: Android, iOS, a real second phone.

## Design Notes

Inviting by a co-treasurer: a join invitation is a chain creator → (co-treasurer) → invitee, at most two links, and the last link's issuer must be the creator or a holder of the co-treasurer role. An invitee who passes their join token on must be refused (closes S-2.3-24); add a test for it. The co-treasurer role therefore carries `member/*` narrowed to what the story needs (`member/invite` and `member/join`), not wider.

The reasons are checked in this order so `apply` and the screens always agree: unreadable, not for you, ended, outside the role, over the limit. "You can't give more than you have" applies only when passing a role on. Until the payment and delivery epics exist, "What can I do?" is how a refusal is tried.

Roles are plain delegations: the creator's token to the holder, optionally a further narrower token from the holder. The chain walk and the lower-or-equal rule are the adapter's; this story adds the catalogue, the recording and the words. The end time is checked against the event's own time until story 3.6, so it can be backdated (S-2.3-7); this is recorded, not solved here.

## Verification

**Commands:**
- `pnpm run ci` -- expected: exit 0, new tests included
- `pnpm --filter @shopong/community test` -- expected: role tests pass, including forged-actor and over-limit cases

**Manual checks (if no CLI):**
- Web: make a community, give a role with a limit, see "Your role", try each refusal. Android only if asked.
