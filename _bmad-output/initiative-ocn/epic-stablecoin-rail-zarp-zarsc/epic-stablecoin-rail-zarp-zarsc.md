---
type: epic
title: "Stablecoin rail (ZARP, ZARsc)"
parent: initiative-ocn
covers: [FR13, AR1, AR3, NFR5]
assignee: ""
risk: high
---

# Stablecoin rail (ZARP, ZARsc)

## Description

The pool can optionally hold and move Rand stablecoin so funds are programmable and provable on-chain. This epic is decision-gated and off the first demonstration's critical path.

## Outcome

For the treasurer and members, the pool can optionally hold and move Rand stablecoin with each move mirrored in the books and shown with an on-chain proof, so all the pool's funds appear in one place once the rail is approved.

## Requirements

- FR13: Funds can optionally be held and moved as a Rand stablecoin, with on-chain proof attached to the record.
- AR1: Every third-party technology sits behind a port with a contract test suite and an in-memory adapter (architecture AD-1).
- AR3: Decisions D-1 to D-8 in the architecture are tracked; spike stories end in a decision record.
- NFR5: Secrets (payment, ledger, LLM keys) exist only on the OCN Node; webhooks are signature-verified and replay-safe; agents run in a sandbox.

## Done when

1. The product owner can point to decision D-1 (ZARP, ZARsc, both, or defer) with its custody model, reviewed with legal input.
2. On testnet, a conversion of part of the pool to stablecoin happens only after the required approvals, and the pool view shows both balances with an on-chain proof link.
3. Redeeming that stablecoin pays a supplier through Stitch, and a failed redemption leaves the funds visible and recoverable.
4. The StableRail contract suite passes for the testnet adapter, and its signing keys are shown to stay on the OCN Node or with the chosen custodian.

## Boundaries

The optional stablecoin rail behind the `StableRail` port: the token decision, the testnet adapter, conversion into the pool and redemption out of it. Not the pooled ledger, pay-in or pay-out (epic 4, which this mirrors into), and not a consumer wallet or an exchange, which the architecture rules out.

## References

- parent — ../initiative-ocn.md
- spec — ../spec-ocn/spec-ocn.md, FR13 line and FR Coverage Map
- constraint — ../architecture-ocn/architecture-ocn.md, section 4.3 "Stablecoin via ZARP / ZARsc" (optional second rail, not on the first demonstration's critical path; testnet first and small amounts; the adapter mirrors each movement as `assets:wallet/stable` entries and stores the transaction signature in the event); section 9 AD-1 (port with contract suite), AD-8 (every ledger posting mirrored as a record event), AD-12 (stablecoin is an optional rail behind a port), D-1
- stories — the acceptance criteria of each story are in its `*-plan.md` file in this folder

## Notes

- Tracer: entry 1, the ZARP versus ZARsc decision, is the thinnest path: it fixes the token and custody model before any adapter code is written.
- Waits on epic 4 because: the ledger and pooled funds that the stablecoin is mirrored into (4.2, 4.6), and the supplier payment path that redemption pays through (4.4, 4.7).
- Unknown: ZARsc's Token-2022 extensions, ZARP's freeze, blacklist and upgrade controls, both tokens' fees and ZARP's CASP licence status are unverified; entry 1 settles them and entries 2 to 4 wait on it.
- Open question: decision D-1 (ZARP, ZARsc, both, or defer) is open and needs legal input on the CASP and FSCA position and custody; entry 2 waits on entry 1 for the chosen token.
- Open question: no Refactor sweep story is planned (the standard asks for one when an epic has more than three entries); the user decides whether to add it.
