---
title: 'SHA-512 content hashes and keyed commitments for personal data'
type: 'feature'
ticket: 7
created: '2026-10-26'
status: 'draft'
baseline_revision: '26c417cdcc44d355a2be80aa0cc66a977dc31da8'
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

**Problem:** The shared record is append-only, so a phone or ID number written to it can never be taken back (POPIA). `packages/events/src/commitment.ts` has the commitment shape and phone normalisation but no production HMAC, no ID-number rule, no community secret, and no way to check an attached file against its hash. Nothing stops a raw personal field reaching an event; only quote names are checked, by shape.

**Approach:** Inject one HMAC-SHA512 (from `@noble/hashes`, already pinned in `apps/shopong`), define a South African ID-number commitment, add a pure `verifyAttachment` that says "verified" or "does not match", and add a pure guard that `apply` uses to refuse an event carrying a raw personal value. The secret is held by the OCN Node (see Q1).

## Boundaries & Constraints

**Always:** Personal values reach the record only as `HMAC-SHA512(communitySecret, normalised value)`, lowercase hex. Plain unsalted SHA-512 of a phone or ID number is never used. Hashing runs the same on Hermes, web and Node (injected `Sha512` and `HmacSha512`). Checks are pure, so `apply` stays deterministic. Plain-language refusal reasons.

**Never:** Writing the community secret to the record, a log, an event or a device. Exact addresses in any event. Any phone or ID input screen (none exists). Storing or sending files (Hyperdrive is story 3.7). Changing the event hash or envelope. A new dependency in `packages/events`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Commit a phone | Any common SA spelling of one number | Same commitment every time | None |
| Commit an ID | 13-digit SA ID, valid check digit | Commitment of the 13 digits | `That doesn't look like an ID number.` |
| Other community | Same value, different secret | Different commitment | None |
| Short secret | Under 32 bytes | Refused | `This community's secret is too short.` |
| Raw phone in a field | Event payload field named `phone`, value `082 123 4567` | Event refused, `rejected/<id>` recorded | `Personal details can't be written to the shared record.` |
| Phone-shaped free text | Quote item named `Sugar 0821234567` | Refused by the shared shape check | Existing quote message |
| Commitment in a field | 128 lowercase hex in a `...Commitment` field | Accepted | None |
| File matches | Bytes whose SHA-512 equals the event's `sha512` | `verified` | None |
| File differs | Changed bytes | `does not match` | Kept, flagged (Q4) |
| No hash recorded | Missing `sha512` | `can't be checked` | None |

## Code Map

- `packages/events/src/commitment.ts` -- `HmacSha512` (injected), `keyedCommitment`, `commitPhoneNumber`, `normalisePhoneNumber`, `isCommitment`, `MIN_COMMUNITY_SECRET_BYTES` (32). Add ID-number normalisation here.
- `packages/events/src/hash.ts` -- `Sha512`, `sha512Hex`, `webCryptoSha512`, `eventIdOf`. `verifyAttachment` goes beside them.
- `packages/events/src/registry.ts` (`PAYLOAD_VALIDATORS`), `envelope.ts` -- the guard's home (envelope internals not yet read).
- `packages/events/test/commitment.test.ts`, `test/vectors.ts`, `vectors/golden.json`, `scripts/gen_vectors.py` -- vectors (`pnpm --filter @shopong/events vectors`).
- `packages/community/src/apply.ts` -- refuses with `rejected/<event id>`; `community.ts` already takes `sha512` in its deps.
- `packages/community/src/quotes.ts` -- `hasPhoneNumber` (lines 89-90), used at lines 121 and 143; the shape rule to share.
- `packages/community/src/invitation.ts` -- `issueInvitation`, `invitationLink`; no secret carried today.
- `packages/ports/src/common.ts` (`Sha512Hex`), `packages/ports/src/ocr.ts` (`DocumentRef.sha512`, `hash_mismatch`).
- `apps/shopong/lib/sha512.ts`, `cryptoPolyfills.ts` (uses `@noble/hashes/sha2.js`), `apps/shopong/lib/community.ts` (`webCryptoSha512`, line 90), `apps/shopong/package.json` (`@noble/hashes` 2.4.0).
- Architecture: sections 4.1 (SHA-512), 6 (identifiers), 7 (POPIA), AD-9.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/events/` -- ID-number normalisation and check digit; `verifyAttachment`; the personal-field guard; tests; regenerate `golden.json` with the script, never by hand
- [ ] `packages/ports/`, `packages/ports-contract/`, `packages/adapters-memory/` -- a `Commitments` port with a contract suite and an in-memory adapter (rule 1), if Q1 A
- [ ] `packages/community/` -- `apply` runs the guard and records the refusal; a test that every event the community writes is free of raw personal values
- [ ] `apps/shopong/` -- inject the production HMAC; keep the secret out of the device (Q1); "verified" / "does not match" wording where a file is checked
- [ ] `_bmad-output/initiative-ocn/shortcuts.md` -- a row per choice, including the erasure limit

**Acceptance Criteria:**
- Given a phone or ID number, when committed, then the same value gives the same commitment and another community's secret gives a different one.
- Given a record event with a raw personal field, then it is refused with the plain reason and the refusal is recorded.
- Given a file and its recorded hash, when re-hashed, then it reads verified or does not match.
- Given `pnpm run ci`, then it passes.

## Verification

**Commands:**
- `pnpm run ci` -- expected: exit 0, new tests included
- `pnpm --filter @shopong/events test` -- expected: commitment, guard and attachment tests pass
- `pnpm --filter @shopong/events vectors` -- expected: only the intended vectors change in `golden.json`

**Manual checks:** Web only: a changed file reads "does not match". Android only if asked.

## Open Questions

**Answered 2026-10-26 by the product owner: all recommended answers accepted.**

1. **Where does the community secret live, and how does a phone get a commitment without holding it?** AGENTS rule 4 says secrets live only on the OCN Node, so a phone holding the secret would break it.
   - A) (recommended) The Node generates the 32-byte secret when a community is made, stores it in its secret store, and computes commitments. A phone sends the normalised value over its authenticated link and gets back the commitment; it never sees the secret. 2.7 builds and tests the function and port; phone calls wait for the phone-to-Node link (3.4/3.5).
   - B) The phone holds the secret and hands it to joiners in the invitation, as the earlier stub proposed. This contradicts rule 4 as written, and a leaked invitation then leaks the secret. Needs a product-owner amendment to rule 4.
   - C) The phone holds a secret sealed to each member's identity at join. Safer than B, but needs encryption to a member key and a second real phone, so it waits for epic 3.
2. **Which fields count as personal data in Demonstration 1?**
   - A) (recommended) Phone numbers and SA ID numbers are committed. Exact addresses never enter an event. Names stay as typed, checked only for phone-shaped digits (as quotes already do).
   - B) As A, and also commit names so members can match them without seeing them.
   - C) Phone numbers only.
3. **How is personal data detected in free-text fields?** `apply` must stay pure, so the check is a pure function.
   - A) (recommended) Field-name guard (`phone`, `idNumber`, `address` and similar must hold a commitment) plus a shape check on free text: 7 or more digits once separators are removed (as quotes do), and any 13-digit run passing the SA ID check digit. Heuristic: it catches mistakes, not deliberate hiding.
   - B) Field-name guard only.
   - C) An on-device or hosted classifier. Not deterministic, and a hosted one sends the text out. Use only in the UI, never in `apply`.
4. **When a file does not match its recorded hash?**
   - A) (recommended) Say "does not match", keep the file and flag it for a person to look at.
   - B) Block the file.
5. **What is a commitment, and how are two members' commitments compared?**
   - A) (recommended) Lowercase hex HMAC-SHA512 (128 characters) of the normalised value, with the community's secret. Members match by exact string equality. Phone numbers normalise to E.164 first; ID numbers to their 13 digits. No truncation, no per-member salt.
   - B) Truncate to 32 hex characters to save space. Fewer bits, and it gains nothing a record needs.
   - C) A per-member salt stored with each commitment. Prevents linking, but then two members' commitments for one number never match.
6. **File hashing for attachments (Hyperdrive itself is story 3.7).**
   - A) (recommended) Plain SHA-512 of the file bytes through the injected `Sha512`; `verifyAttachment(bytes, sha512)` is pure and returns verified or does not match. The event carries the hash only, not the bytes. Hyperdrive later stores the file and the same hash.
   - B) As A, but hashed in chunks so a large file is never held whole. Needs an incremental SHA-512 in the app; defer until 3.7 brings large files.
   - C) Use the Hyperdrive Merkle root instead. Rejected: the architecture needs the hash to stand apart from Hyperdrive.

## Notes on this draft

- Replaces the earlier stub. Its frozen Intent and matrix were dropped and rewritten to match the current code and rules; its Q1 option B conflicts with rule 4.
- Baseline is the current HEAD (`26c417c`), not the stub's `859dc6c`.
- Not verified: the envelope internals in `envelope.ts`; the HMAC export path of `@noble/hashes` 2.4.0 (check before coding); the Node secret-store loader (`apps/node`, not read); whether `gen_vectors.py` runs here (not run); the existing `shortcuts.md` rows for this story.
