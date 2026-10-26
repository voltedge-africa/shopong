---
title: 'Verify authority on device, in the record and at the Node'
type: 'feature'
ticket: 5
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

**Problem:** Authority is checked on the phone and in the record's `apply`, but the OCN Node, which will pay suppliers, checks nothing and does not know who is calling. Role tokens sit in the record where any member can read them, so without proof that the caller holds the key, one member could present another's role.

**Approach:** One shared verification module, used in three places: the device (device clock, plain reason, a local log of refusals), the record (`apply`, the event's time, `rejected/<id>`), and the Node (the Node's own clock, an authenticated caller, an audit log). The `CapabilityAuth` port gains `sign` and `verifySignature` so a caller can prove it holds its key; the Node checks the actor's signature on every request before it checks the capability.

## Boundaries & Constraints

**Always:** Verification takes its time as an explicit input and never reads the clock or the network itself. A valid chain verifies with no network call. The Node checks against the holder's current role record, not any token that is still valid. Plain-language reasons on the device. Secrets and signing keys never leave their owner.

**Never:** Wiring the record onto Autobase (story 3.2). Revoking a role early (2.6). Moving or checking money (epic 4). Changing the meaning of an existing port method.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Tampered proof | A changed token | Refused in all three places; reason recorded | Device: plain reason and local log; record: `rejected/<id>`; Node: audit log |
| Missing proof | No token where one is needed | Refused in all three places | As above |
| Valid chain | A good chain, no network | Verifies in all three places | None |
| Stolen role | Member B presents member A's role token | Refused at the Node | "This role isn't yours." |
| Ended at the Node | A role past its end by the Node's clock | Refused at the Node | "Your role ended on <date>." |
| Replaced grant | An old, higher grant presented after a lower one replaced it | Refused (current record wins) | "Your role doesn't cover that." |
| Replayed request | The same signed request sent twice | The second is refused | "That request was already used." |
| Clock skew | A request time within the allowed skew | Accepted | None |
| Clock skew too large | A request time outside the skew | Refused | "Check your phone's clock." |

</frozen-after-approval>

## Open Questions

**Answered 2026-10-26 by the product owner: all recommended answers accepted.**

1. **Where does the record wiring live?** The epic notes ask whether the `apply` and Corestore wiring moves to epic 3.
   - A) Epic 3 (stories 3.2 and 3.5) owns it. This story builds the three checks and the Node's request authentication against the ports. Recommended: it keeps this story testable without the record on disk.
   - B) This story also wires the real record. Larger and tied to 3.2.
2. **Which clock does the Node use?**
   - A) The Node's own clock, passed to `verify` as an explicit time, with a small allowed skew (2 minutes) on request times. `apply` keeps using the event's time, so it stays deterministic.
   - B) The record's log time (story 3.6), which does not exist yet.
3. **How does the Node know who is calling?**
   - A) The caller signs each request (method, path, a hash of the body, a one-time number and the time) with its identity key; the Node verifies it. This adds `sign` and `verifySignature` to the port, with contract cases on both adapters.
   - B) A session token issued after one signed handshake. Less work per request, but builds on A anyway.
4. **Where is a refusal recorded?** The ticket says "recorded in all three places".
   - A) Device: a local log of the last 20 refusals shown on the community card. Record: `rejected/<id>` (exists). Node: an audit log line with the reason and a request id (not written into the shared record, so the record does not grow with every refusal).
   - B) The Node also writes each refusal into the record. Every phone sees it, but a hostile caller can grow the record (S-2.3-22).
5. **Does this story close the replaced-grant gaps (S-2.4-15, S-2.4-16)?**
   - A) Yes: the Node checks the holder's current role record, and only the original giver or the creator may replace a role. Early revoking stays 2.6.
   - B) Leave both to 2.6.
6. **Offline checks on the phone.** A phone without a recent copy of the record may allow something the Node later refuses.
   - A) Accept it: the phone checks what it can see, and the Node is the final guard for anything with a real-world effect.
   - B) Refuse on the phone whenever the record copy is older than a set age.

## Code Map

- `packages/ports/src/capability-auth.ts` and `packages/ports-contract/src/capability-auth.ts` -- the port has `createIdentity`, `issue`, `decode`, `tokenId`, `verify` and no way to sign or check a signature. Add `sign(identity, bytes)` and `verifySignature(did, bytes, signature)` with contract cases.
- `packages/adapter-ucan-iso/src/adapter.ts` -- holds the signers privately keyed by DID, and already imports the signature verifiers and the `did:key` resolver; expose them through the new methods. `packages/adapters-memory/src/capability-auth.ts` -- same for the in-memory adapter.
- `packages/community/src/invitation.ts` (`checkInvitation`), `roles.ts` (`checkAction`, `checkToken`, `recordRoleGrant`), `chain.ts`, `apply.ts` -- the existing device and record checks; pull the shared parts into one module and have the device log refusals.
- `apps/node/src/app.ts` -- only `GET /health` and `GET /ready`; add request authentication (a Fastify hook) and a protected `POST /authority/check` that returns allowed or the reason, so later stories (payments, 4.7) have something to call. `apps/node/src/redact.ts` -- keep signatures and tokens out of logs.
- `apps/shopong/lib/community.ts`, `CommunityProvider.tsx`, `components/CommunityCard.tsx` -- the local refusal log and where it shows.
- `_bmad-output/initiative-ocn/shortcuts.md` -- S-2.3-7, S-2.3-12, S-2.3-20, S-2.3-23, S-2.4-2, S-2.4-9, S-2.4-10, S-2.4-15, S-2.4-16 name this story; close or update each.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/ports`, `packages/ports-contract`, both adapters -- `sign` and `verifySignature` with contract cases -- proof that a caller holds its key
- [ ] `packages/community` -- one shared verification module for the three places, reasons in plain words, a device refusal log, the current-record rule and who may replace a role -- the checks
- [ ] `apps/node/src/` -- request authentication (signature, one-time number, time within skew) and `POST /authority/check`, with an audit log and redaction -- the Node's check
- [ ] `apps/shopong/` -- show the device's refusal log on the community card -- the user-facing part
- [ ] `_bmad-output/initiative-ocn/shortcuts.md` -- close or update the rows above, add this story's own

**Acceptance Criteria:**
- Given a tampered or missing proof, then it is refused in the device check, in `apply`, and at the Node, each with its reason recorded.
- Given a valid chain, then it verifies in all three places with the network trapped.
- Given member B presenting member A's role, then the Node refuses it.
- Given `pnpm run ci`, then it passes.

## Implementation Notes

## Plan Change Log

## Review Triage Log

Pass 1 (one Haiku read-only reviewer, 2026-10-26). 9 findings: 1 high, 2 medium, 6 low.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | A grant survives replacement of its parent grant | high, real | patch | Failing test written first (device and Node), fixed in all three places; mutation check: removing the ancestor check fails two tests |
| 2 | Replay state is per process, lost on restart | medium, real | defer | S-2.5-12 |
| 3 | Unbounded nonce store, full scan per request, nonce not validated | medium, real | patch | Nonce format check, cap of 10,000 (refuse when full), amortised pruning; mutation checks fail one test each |
| 4 | Unverified actor written to the audit log | low, real | patch | Logged as `claimedActor`, truncated, before the signature passes |
| 5 | Query string outside the signature | low, latent | defer | S-2.5-13 |
| 6 | `sign()` has no domain separation | low, latent | defer | S-2.5-14 |
| 7 | Node never configures authority, answers 503 | low, real | defer | S-2.5-15 (story 3.5 / 4.7) |
| 8 | Refusal log is memory only | low, known | defer | S-2.5-6 |
| 9 | Matrix coverage gaps | low, real | patch | Ancestor, missing proof on device, apply with the network trapped |

## Design Notes

The Node's clock is the guard for expiry: on a phone, or in `apply`, the time is whatever the sender claims (S-2.3-7), so only the Node's own time can be trusted before money moves. The signature proves possession of the identity key, which closes S-2.4-9: a token copied from the record is useless without the key it names.

## Verification

**Commands:**
- `pnpm run ci` -- expected: exit 0, new tests included
- `pnpm --filter @shopong/node test` -- expected: authentication and authority tests pass, including stolen role and replayed request

**Manual checks (if no CLI):**
- Start the Node, call `POST /authority/check` with a signed request and with a tampered one, and read the audit log.
