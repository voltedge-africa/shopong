---
title: 'Create a community and join by invitation'
type: 'feature'
ticket: 3
created: '2026-10-26'
status: 'in-progress'
baseline_revision: '613a996a7368c862dbedd6e956321291d05c2420'
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

**Problem:** A person with an identity (story 2.2) still has nowhere to belong. Stokvels, retailers and every later flow start from a community that a treasurer creates and members join, and a join must be checkable on the phone with no network.

**Approach:** A new `@shopong/community` package holds the rules: make a community, issue an invitation (a `member/join` UCAN), check one with a plain reason when it fails, and an `apply` that records `member.joined` once per invitation. The app gets a community card in Settings and a Join screen. The record is the in-memory `SharedRecord` from epic 1.

## Boundaries & Constraints

**Always:** Check an invitation with `CapabilityAuth.verify` against the creator's DID and an explicit time, with no network. Keep `apply` deterministic (time comes from `claimedAt`). Reasons shown to people in plain words. Nothing outside `packages/adapter-ucan-iso` imports `iso-ucan`. No new third-party dependency.

**Never:** Roles with limits (2.4), verifying authority in the record and at the Node (2.5), revocation (2.6), the Hyper stack or any network (epic 3), changing the `CapabilityAuth` port, resuming a join link after the PIN screen.

**Decisions (product owner, 2026-10-26):**
1. Named invitations: the newcomer sends their full DID to the treasurer, who issues the invitation to that DID. No port change.
2. The "code" is the same text as the link, pasted into a Join box. No short code.
3. Tests prove the two-phone flow with simulated phones. The app gets the treasurer side (create, invite, member list) and a Join screen that checks an invitation and gives the plain reason. A real join between two phones waits for epic 3.
4. An invitation lasts 7 days, fixed.
5. A reused invitation: the first `member.joined` in log order wins, and a later one is rejected when it syncs.
Every shortcut these choices take is in `_bmad-output/initiative-ocn/shortcuts.md` (S-2.3-*).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create | A name, identity exists | Community made; I am its creator and only member | None |
| Empty name | Blank name | Nothing made | "Give your community a name." |
| Invite | A person's DID | Link and code for that person, valid for 7 days | "That doesn't look like an identity." for a bad DID |
| Join | Valid invitation for me, no network | `member.joined` recorded; I appear as a member | None |
| Expired | Past its end time | Not joined | "This invitation has expired." |
| Reused | Its id is already in a `member.joined` | Not joined | "This invitation was already used." |
| Someone else's | Invitation names another DID | Not joined | "This invitation is for someone else." |
| Unreadable | Tampered, wrong community, or garbage | Not joined | "This invitation can't be checked." |
| No identity | Join before creating an identity | Not joined | "Make your identity first." |

</frozen-after-approval>

## Code Map

- `packages/events/src/registry.ts` -- `member.invited` and `member.joined` payloads are loose placeholders; this story replaces them with strict schemas (the file says the first story to write a type must).
- `packages/ports/src/shared-record.ts`, `packages/adapters-memory/src/shared-record.ts` -- `createMemoryRecordNetwork().peer(did).create(def)` / `.open(key, def)`; writers are admitted only inside `apply` via `host.addWriter`; `replicate(a, b)` for two simulated peers.
- `packages/scenario-stokvel/src/apply.ts` and `world.ts` -- a working `createApply`, `encodeProof` / `decodeProof` and `aliasDidKey` to copy from; they are seeded and scripted, so do not import them.
- `packages/ports/src/capability-auth.ts` -- `verify({required, rootIssuer, logTime, audience})`; error codes `expired`, `wrong_audience`, `wrong_root`, `broken_chain`, `malformed`. Abilities are strings such as `member/invite` and `member/join`; the resource is `ocn:space/<key>`. There is no helper for it.
- `packages/adapter-ucan-iso` and `apps/shopong/lib/identity.ts`, `IdentityProvider.tsx` -- the real adapter and the person's identity; the app already holds one `CapabilityAuth`.
- `apps/shopong/app/_layout.tsx`, `app/(tabs)/settings.tsx`, `components/IdentityCard.tsx` -- provider tree and where the cards live. `app.json` has scheme `shopong`, so `app/join.tsx` is reachable as `shopong://join?...`. The identity card shows only a short DID; the full DID needs sharing for Q1 A, using React Native's built-in `Share`.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/events/src/registry.ts` and its test -- strict `member.invited` and `member.joined` payloads -- replaces the placeholders
- [ ] `packages/community/` (`space.ts`, `invitation.ts`, `apply.ts`, `index.ts`, tests) -- space URI and 64-hex community key, issue and check an invitation with plain reasons, an `apply` that records one join per invitation id -- the rules, testable with two simulated phones
- [ ] `apps/shopong/lib/community.ts` and `CommunityProvider.tsx`, `app/_layout.tsx` -- one in-memory network, create, invite, join -- app wiring
- [ ] `apps/shopong/components/CommunityCard.tsx`, `app/(tabs)/settings.tsx`, `app/join.tsx`, `components/IdentityCard.tsx` -- the screens and the share action -- the user-facing part

**Acceptance Criteria:**
- Given an identity, when I create a community and invite a person, then I get a link and a code for that person.
- Given a valid invitation for me and no network, when I join, then `member.joined` is recorded and I am a member.
- Given an expired, reused or someone else's invitation, when I try to join, then I am refused with the plain reason in the matrix.
- Given `pnpm run ci`, then it passes.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Design Notes

Shortcuts taken by this story, and by 2.1 and 2.2, are in `../shortcuts.md`. Add a row there for any further shortcut.

Community key: 32 random bytes as 64 hex (event `space` needs 64 hex; the memory adapter's own key differs). Invitation id is the token id from `CapabilityAuth.tokenId`; `member.joined` carries it so `apply` can see it was used. The joiner's check uses the device clock as `logTime`; `apply` uses the event's `claimedAt`.

## Verification

**Commands:**
- `pnpm run ci` -- expected: exit 0, new tests included
- `pnpm --filter @shopong/community test` -- expected: invitation and apply tests pass

**Manual checks (if no CLI):**
- Web: create a community, invite a DID, see the link and code, paste a bad code into Join and see the plain reason. Android only if asked.
