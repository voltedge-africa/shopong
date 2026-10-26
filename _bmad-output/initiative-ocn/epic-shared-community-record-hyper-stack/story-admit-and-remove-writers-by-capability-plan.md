---
title: 'Admit and remove writers by capability'
type: 'feature'
ticket: 3
created: '2026-10-26'
status: draft
baseline_revision: '26c417cdcc44d355a2be80aa0cc66a977dc31da8'
route: 'full'
---

## Intent

**Problem:** Admission already exists in part. `community/apply.ts` calls `host.addWriter` on `member.invited` (not on `member.joined`), and the Autobase adapter (3.2) already admits, re-admits and removes writers. Nothing removes a member by capability: `member.removed` is listed in `packages/events/src/registry.ts` with no payload type, and `apply` never calls `removeWriter`. The "last indexer" rule has no code behind it.

**Approach:** Keep the 3.2 host calls. Admit a writer only on a verified `member.joined`. Add a `member.removed` event, checked by capability, that removes the writer and the membership. The adapter refuses to remove the last indexer. Earlier events stay in the record.

**Already done (do not re-plan):** 3.2: DID-to-key map in the view, derived writer keys, `addWriter` on invite, re-admission of a known key, `removeWriter` with the creator guard, the removed-writer and re-admission tests. 2.5: `verifyAuthority` on join, the `not_yours` and `not_current` checks.

## Boundaries & Constraints

**Always:** `apply` stays deterministic (no clock, network or randomness; log time is `claimedAt`). Every removal is checked on `event.actor`, as `apply` already does. The port (`packages/ports/src/shared-record.ts`) and its contract suite do not change. Removed history is never edited.

**Never:** Revoking UCAN roles (story 2.6). Phone-side writers (AD-21). Removing the creator. Touching the Node's secrets or key derivation.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Admit on join | Verified `member.joined` by an invitee | Writer admitted, `members/<did>` set | Refused: `unreadable` / `already_used` |
| Invite only | `member.invited` with no join yet | No writer admitted (planned change) | None |
| Remove member | Creator or co-treasurer removes a member | `removeWriter`, `members/<did>` deleted | Refused: not permitted |
| Remove creator | Any actor names the creator | Refused | `creator_not_removable` |
| Last indexer | Removal would leave zero indexers | Refused, writer kept | `last_indexer` (to `rejected/<id>`) |
| Earlier events | Removed writer wrote before removal | Stay in view | None |
| Later append | Removed writer appends after removal | Entry skipped | `not_writable` at append |
| Re-admit | Same DID, new invitation and join | Known key re-admitted | Old invitation: `already_used` |

## Open Questions

**Answered 2026-10-26 by the product owner: all recommended answers accepted.**

**Note (2026-10-26):** story 3.5 found that one Autobase copy can write as only one person, and the product owner chose option A there: the Node keeps one record copy per member, each writing as that member and syncing into the Node's main copy. Removal in this story must work with that model: removing a member also closes and stops syncing that member's copy, and re-admission opens it again. Build this story after story 3.5 has merged.

1. **When is a writer admitted?**
   - A) Move `addWriter` from `member.invited` to a verified `member.joined`. (Recommended: the ticket says "through a valid invitation UCAN chain", and today an invitee can write before any chain is checked.)
   - B) Keep admission at invite and add a UCAN check to `invited()`.
   - C) Keep as is and change the ticket's verify line.
2. **Who may remove whom?**
   - A) The creator or a co-treasurer may remove any member except the creator. A member may leave by removing themselves. (Recommended: mirrors who may invite.)
   - B) Only the creator may remove.
   - C) Co-treasurers may not remove.
3. **Last indexer.** Demonstration 1 has one indexer, the Node, and no member is flagged as one.
   - A) Keep an explicit indexer set in the view, seeded with the creator's key; refuse any removal that leaves it empty; test with a second flagged indexer. (Recommended.)
   - B) Drop the guard until phones are indexers (contradicts the ticket verify).
   - C) Rely on Autobase's `host.removeable`. Unverified (see Verification).
4. **Earlier events of a removed writer.**
   - A) Keep them as applied; removal stops new entries. The log is append-only. (Recommended.)
   - B) Keep them and add a `removed` marker in the view.
   - C) Drop them on rebuild. Rejected: it changes history.
5. **Removal and roles.**
   - A) Removal does not touch role grants; 2.6 does revocation. (Recommended.)
   - B) Removal also writes `role.revoked` for each grant.
6. **Re-admission.**
   - A) Only by a new invitation and a new join. Removal deletes `members/<did>` so the "Already a member" check passes. (Recommended.)
   - B) Re-admit with the old invitation.

## Code Map

- `packages/community/src/apply.ts` -- `apply`; `invited()` calls `addWriter` (move, Q1); add the `member.removed` branch.
- `packages/community/src/invitation.ts` -- `INVITATION_MESSAGES`, `JOIN_ABILITY`.
- `packages/community/src/authority.ts` -- `verifyAuthority`, used on join.
- `packages/community/src/roles.ts` -- `isCurrentGrantIn`, `isCoTreasurer` (who may remove, Q2).
- `packages/events/src/registry.ts` -- `member.removed` in the type list, no payload type yet.
- `packages/record-autobase/src/record.ts` -- `removeWriter` host call, `_sys/writer` and `_sys/key` keys, creator guard, `host.removeable` call.
- `packages/record-autobase/src/keys.ts` -- derived writer keys (no change expected).
- `packages/record-autobase/src/adapter.test.ts` -- re-admission test, `apply` guard tests; `removeable` is stubbed to `true`.
- `packages/ports/src/shared-record.ts` -- `ApplyHost.removeWriter`. Do not change.
- `packages/ports-contract/src/shared-record.ts`, `packages/adapters-memory/src/shared-record.ts` -- the removed-writer cases to keep passing.
- `_bmad-output/initiative-ocn/shortcuts.md` -- add S-3.3 rows.

## Tasks & Acceptance

**Execution:**
- [ ] Confirm `host.removeable` semantics in the pinned autobase 7.28.2 (install only the pinned lockfile) and record them in the PR.
- [ ] `packages/events/src/registry.ts` -- add the `member.removed` payload type and schema (`member`, optional `reason`).
- [ ] `packages/community/src/apply.ts` -- admit on verified join (Q1); add `member.removed` (Q2, Q5, Q6); refuse the creator.
- [ ] `packages/record-autobase/src/record.ts` -- indexer set and last-indexer refusal (Q3); no silent delete of `_sys/writer` when a removal is refused.
- [ ] Tests in `packages/community` and `packages/record-autobase` for each matrix row.
- [ ] `shortcuts.md` rows for each choice; the PR names them.

**Acceptance Criteria:**
- Given a verified `member.joined`, then `host.addWriter` runs and the member is a writer.
- Given a removal by the creator or a co-treasurer, then `removeWriter` runs and the member's later appends are refused as `not_writable`.
- Given a removal that would leave no indexer, then it is refused and recorded with reason `last_indexer`.
- Given an event from a removed writer before its removal, then it stays in the view on every replica.
- Given the port's contract suite, then the adapter still passes every case.
- Given `pnpm run ci`, then it passes.

## Verification

**Commands:**
- `pnpm run ci` -- expected: exit 0.
- `pnpm --filter @shopong/record-autobase test` -- expected: removal, last-indexer and re-admission tests pass.
- `pnpm --filter @shopong/community test` -- expected: join-admission and `member.removed` tests pass.

**Not verified in drafting:** no `node_modules` in the worktree or the main checkout, so the Autobase `removeable` behaviour and the existing test outcomes were read from source, not run.
