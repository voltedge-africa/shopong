---
title: 'SHA-512 content hashes and keyed commitments for personal data'
type: 'feature'
ticket: 7
created: '2026-10-26'
status: 'draft'
baseline_revision: '859dc6c8b42f4a81411445c79de6d7e84daf56c3'
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

**Problem:** The shared record is append-only, so a phone number or ID number written to it can never be taken back (POPIA). The commitment logic exists (`keyedCommitment`, `commitPhoneNumber`, phone normalisation) but nothing real is plugged in: there is no production HMAC, no community secret, no way to check an attached file against its hash, and nothing stops a raw personal value reaching the record.

**Approach:** Plug in one HMAC-SHA512 built on `@noble/hashes`, give each community a secret, add a function that re-hashes an attached file and says "verified" or "does not match", and add a guard that refuses a record event carrying a raw phone number, ID number or address field.

## Boundaries & Constraints

**Always:** Personal data reaches the record only as `HMAC-SHA512(communitySecret, normalised value)`; plain unsalted SHA-512 of a phone or ID number is never used. The community secret is never written to the record, a log, or an event. Hashing and HMAC run the same on Hermes, web and Node. Plain-language wording for "verified" and "does not match". No new third-party dependency beyond `@noble/hashes`, already in the app.

**Never:** Collecting phone or ID numbers in a screen (no feature asks for one yet). Exact addresses anywhere in the record (they stay on the device). The OCN Node holding the secret (epic 3). Storing or sending files (Hyperdrive is story 3.7). Changing the event hash.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Commit a phone | A phone number in any common South African spelling | The same commitment every time | None |
| Commit an ID | A 13-digit South African ID number | A commitment of the normalised digits | "That doesn't look like an ID number." (returned by the helper; no screen asks for one yet) |
| Different community | The same value, another community's secret | A different commitment | None |
| Short secret | A secret under 32 bytes | Refused | "This community's secret is too short." |
| Raw value in an event | A record event with a `phone`, `idNumber` or `address` field holding a raw value | The event is refused | "Personal details can't be written to the shared record." |
| Commitment in such a field | The same field holding a commitment (128 hex characters) | Accepted (the existing golden vector does this) | None |
| File matches | A file and the hash recorded for it | "Verified" | None |
| File differs | A changed file and the recorded hash | "Does not match" | None |
| No hash recorded | A file with no recorded hash | "Can't be checked" | None |

</frozen-after-approval>

## Open Questions

1. **Where does the community secret come from, and how does a member get it?**
   - A) The creator's phone makes 32 random bytes when the community is made, keeps them in the keystore, and puts them in the invitation text a new member receives (never in an event or the record). Simple, but anyone who sees an invitation link can then guess phone numbers against every commitment (there are only about a billion), so a leaked invitation also leaks privacy. Another member's phone holds the same secret, so losing the creator's phone does not lose it.
   - B) Hand the secret over only after the person has joined, sealed to their own identity. Safer, but needs encryption to a member's key and a real second phone, so it waits for epic 3.
   - C) Wait until the OCN Node holds secrets (epic 3). Nothing usable meanwhile.
2. **What counts as personal data now?**
   - A) Phone numbers and South African ID numbers (13 digits, check digit validated), and a rule that exact addresses are refused outright.
   - B) Phone numbers only for now.
3. **Should the record refuse raw personal fields?**
   - A) Yes: a name-based guard in the event checks refuses a field named phone, idNumber, address or similar unless its value is commitment-shaped (128 hex characters), and requires commitment-shaped values in any field named `...Commitment`. Heuristic, so it catches mistakes, not attackers, and it only guards new events: the record is append-only, so anything written earlier stays.
   - B) No guard; only the helpers and tests.
4. **When a file does not match its hash:**
   - A) Show "does not match", keep the file, and flag it.
   - B) Block it.
5. **Erasure (POPIA).** A commitment in an append-only log cannot be deleted.
   - A) Accept and document it: a commitment cannot be deleted, and the only way to make them unlinkable is for every member to delete the secret from their phone, which cannot be forced. Say so plainly in the register.
   - B) Per-member secrets that can be destroyed individually. More work, and it breaks matching across members.

## Code Map

- `packages/events/src/commitment.ts` -- `HmacSha512` (injected), `keyedCommitment`, `commitPhoneNumber`, `normalisePhoneNumber`, `isCommitment`, `MIN_COMMUNITY_SECRET_BYTES` (32). The test HMAC is WebCrypto; production injects `@noble/hashes`. Reuse; add ID-number normalisation here.
- `packages/events/src/hash.ts` -- `sha512Hex`, `webCryptoSha512`, `eventIdOf`. The attachment check uses the same `Sha512` type.
- `packages/events/test/commitment.test.ts`, `vectors/golden.json`, `scripts/gen_vectors.py` -- vectors for commitments; extend, regenerating vectors from the script as in story 2.3.
- `packages/events/src/registry.ts` and `envelope.ts` -- where the personal-field guard goes.
- `apps/shopong/lib/sha512.ts` -- dependency-free SHA-512 used on Hermes (no `crypto.subtle`); `lib/cryptoPolyfills.ts` fills `subtle.digest` from `@noble/hashes`. `@noble/hashes` 2.4.0 is already an app dependency, but not of `packages/events`.
- `packages/community/src/community.ts`, `invitation.ts` -- where the secret is made and handed over (Q1).
- `packages/ports/src/geo.ts` and its contract -- already coarsen locations; follow that style for the address rule.

## Tasks & Acceptance

**Execution:**
- [ ] Check what already exists first: search the event types, the scenario and the golden vectors for raw personal fields, and list any
- [ ] `packages/events/` -- production `hmacSha512` on `@noble/hashes`, ID-number normalisation, `verifyAttachment`, and the personal-field guard, with tests and regenerated vectors
- [ ] `packages/community/` -- make and keep the community secret, hand it over with the invitation (Q1), and a test that no event the community writes carries a raw personal value
- [ ] `apps/shopong/` -- wire the production HMAC into the app, keep the secret in the keystore, and show "verified" / "does not match" wording where a file is checked
- [ ] `_bmad-output/initiative-ocn/shortcuts.md` -- rows for each choice, including the erasure limit

**Acceptance Criteria:**
- Given a phone or ID number, when it is committed, then the same value gives the same commitment and another community's secret gives a different one.
- Given a record event with a raw personal field, then it is refused with the plain reason.
- Given a file and its recorded hash, when it is re-hashed, then it reads verified or does not match.
- Given `pnpm run ci`, then it passes.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Design Notes

The commitments are only as private as the secret: anyone holding it can test guesses against a commitment, so it must reach only members; an invitation that carries it makes a leaked invitation a privacy leak (question 1). If every phone that holds the secret is lost, commitments can no longer be matched, but nothing else breaks (attachment hashes are not keyed). Commitments made on different platforms must be byte-identical; the golden vectors prove it. No screen collects a phone or ID number yet, so this story builds and proves the safe path before any feature needs it.

## Verification

**Commands:**
- `pnpm run ci` -- expected: exit 0, new tests included
- `pnpm --filter @shopong/events test` -- expected: commitment, guard and attachment tests pass

**Manual checks (if no CLI):**
- Web: confirm a community's events never carry a raw personal value, and a changed file reads "does not match". Android only if asked.
