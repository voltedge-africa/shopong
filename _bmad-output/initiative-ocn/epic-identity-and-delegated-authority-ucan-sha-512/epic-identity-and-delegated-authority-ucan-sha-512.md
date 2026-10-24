---
type: epic
title: "Identity and delegated authority (UCAN, SHA-512)"
parent: initiative-ocn
covers: [FR1, FR2, FR3, FR28, AR1, AR3, AR10, AR12, NFR3]
assignee: ""
status: in-progress
risk: high
---

# Identity and delegated authority (UCAN, SHA-512)

## Description

A person owns their identity on their device, joins communities by invitation, holds roles with limits, and any party can verify who may do what without a central user table. Authority can be revoked, expires and can be recovered.

## Outcome

Community members and treasurers hold identity and limited roles on their own devices that any party can verify, shown by a member joining by invitation and a delegation above its ceiling being refused.

## Requirements

- FR1: A person can create a self-sovereign identity on their own device and prove it to others.
- FR2: A person can create a community space (for example a stokvel) and invite members into it.
- FR3: Authority inside a community is delegated as roles with limits (for example a payment ceiling) and can be revoked or expire.
- FR28: Keys, the record and the ledger mapping can be backed up and recovered after device loss.
- AR1: Every third-party technology sits behind a port with a contract test suite and an in-memory adapter (architecture AD-1).
- AR3: Decisions D-1 to D-8 in the architecture are tracked; spike stories end in a decision record.
- AR10: Personal data is stored as `HMAC-SHA512(communitySecret, value)` commitments, with an audited HMAC library because expo-crypto has none.
- AR12: A member's Corestore `primaryKey` is derived from their identity seed with a KDF so one recovery phrase restores identity and writer keys (architecture AD-18).
- NFR3: Personal information is minimised (POPIA): the shared record holds keyed commitments, not phone or ID numbers; exact addresses stay on the device.

## Done when

1. A person creates an identity on their phone, sees a short DID, and a reinstall without a backup offers recovery instead of the old identity.
2. A treasurer invites a member by link or code; the member joins offline, and an expired or reused invitation is refused with a reason shown.
3. A treasurer delegates a role with a lower ceiling and it is accepted; a higher ceiling or wider resource is refused; a delegated role stops at its expiry with the reason shown.
4. A tampered or missing authority proof is refused on the device, in the record and at the Node, and a valid chain verifies with no network call.
5. Restoring from a recovery phrase on a new device recovers the same DID and writer keys, and a revoked key's actions are refused from the next sync.
6. The shared record holds only HMAC-SHA512 commitments for phone and ID numbers, and a re-hashed attachment reads verified or does not match.

## Boundaries

Identity, invitations, delegated roles, their verification, and the recovery and revocation of keys. It is not the replicated record and its apply, which is epic 3 (shared community record), not the payment ceilings the pool enforces (epic 4 consumes `payment/approve`), and not the agent-scoped authority of epic 11.

## References

- parent — ../initiative-ocn.md, the epic list
- spec — ../spec-ocn/spec-ocn.md, Requirements Inventory (FR1, FR2, FR3, FR28, AR1, AR3, AR10, AR12, NFR3)
- constraint — ../architecture-ocn/architecture-ocn.md, section 9 Decisions (AD-6: `apply` is pure and capability expiry uses log time; AD-9: PII is stored as keyed commitments)
- constraint — ../architecture-ocn/architecture-ocn.md, section 4.1 Identity (UCAN via ts-ucan; SHA-512 via expo-crypto)
- input — the acceptance criteria of each story are in its `*-plan.md` file in this folder

## Notes

- Tracer: entry 1, the UCAN library spike, is the thinnest path: one capability chain built, signed and verified on each platform.
- Waits on epic 1 because: the capability ports and the event envelope (1.2, 1.3) that the spike, invitations, verification and the saved `member.joined` event build on.
- Assumption: entry 3 writes `member.joined` through the in-memory `SharedRecord` port from epic 1, so the Hyper stack in epic 3 is not needed for this entry.
- Open question: entries 5 and 6 name the shared record's `apply` and the Corestore `primaryKey` wiring, which epic 3 builds; epic 3 already waits on entry 2.5, so epic 2 cannot pin those back. The user decides whether that wiring moves to epic 3 or epic 2 builds the verifier and KDF against the ports and leaves the wiring to epic 3.
- Open question: no Refactor sweep story is planned (the standard asks for one when an epic has more than three entries); the user decides whether to add it.
