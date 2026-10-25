---
type: epic
title: "Shared community record (Hyper* stack)"
parent: initiative-ocn
covers: [FR2, FR4, FR5, AR2, AR3, AR4, AR7, AR11, NFR1, NFR2, NFR4, NFR9]
assignee: ""
status: in-progress
risk: high
---

# Shared community record (Hyper* stack)

## Description

Each community has a transparent, replicated record that works offline, converges when devices reconnect, admits writers by capability, and can be queried.

## Outcome

Community members and organisers get one record of what was agreed and done that works offline and converges, and the signal is two devices that diverge offline reconverging to the same view with no lost events.

## Requirements

- FR2: A person can create a community space (for example a stokvel) and invite members into it.
- FR4: A community has a shared, replicated, transparent record of what was agreed and done, usable offline and convergent when reconnected.
- FR5: Documents and photos can be attached to the record and verified by their hash.
- AR2: Versions are pinned, notably DuckDB-WASM (the docs and the npm `latest` tag disagree).
- AR3: Decisions D-1 to D-8 in the architecture are tracked; spike stories end in a decision record.
- AR4: The shared record uses one versioned event envelope; one Autobase per community space with a Hyperbee view and Hyperdrive for files (AD-2).
- AR7: Heavy WASM (DuckDB, Kepler.gl, Valhalla) runs in the web console; mobile receives results (AD-5).
- AR11: The Bare worklet is bundled with `bare-pack`, its native addons are linked by the app with `bare-link`, and the UI talks to it over a typed RPC (hyperschema + bare-rpc); iOS background time is treated as about 30 seconds, so the OCN Node seeder carries background sync.
- NFR1: Core community flows (propose, pledge, view, confirm delivery) work offline and converge without data loss when devices reconnect.
- NFR2: The Shopong app meets a memory, battery and data budget on a low-end Android baseline (to be fixed with decision D-6).
- NFR4: The shared-record `apply` function is deterministic: no wall clock, no network, no randomness; verified by replay tests.
- NFR9: Flows are usable with low data cost and in low-connectivity conditions.

## Done when

1. Two devices that diverge offline reconverge to the same view with no lost events, and unseen events show "on your phone" until the group has seen them.
2. Replaying the same events in different arrival orders on two devices gives byte-identical views.
3. A new member who joins by a valid invitation becomes a writer, and removing a member never removes the last indexer.
4. An attached file carries its SHA-512; a receiving device fetches and verifies it, and a freed blob is re-fetched on demand.
5. The OCN Node serves the record when the phones are off, and a device behind NAT syncs through its relay.
6. The web console runs a SQL query over the exported community view and renders the result as a table.

## Boundaries

Each community's shared record: its Autobase, Hyperbee view, deterministic apply, writers, offline convergence, the Node as seeder and relay, Hyperdrive files, and the first SQL view in the web console. It is not the identity and UCAN verification it calls (epic 2, identity and delegated authority), not the ledger postings that mirror into the record (epic 4), and not document OCR or decisions (epic 6). The optional Bluetooth entry is a spike only.

## References

- parent — ../initiative-ocn.md, the epic list
- spec — ../spec-ocn/spec-ocn.md, Requirements Inventory (FR2, FR4, FR5, AR2, AR3, AR4, AR7, AR11, NFR1, NFR2, NFR4, NFR9)
- constraint — ../architecture-ocn/architecture-ocn.md, section 9 Decisions (AD-2: one Autobase per community space with our own `apply`, Hyperbee view, Hyperdrive for files, not Autobee; AD-6: `apply` is pure and capability expiry uses log time)
- input — the acceptance criteria of each story are in its `*-plan.md` file in this folder

## Notes

- Tracer: entry 1, the Hypercore stack spike in a Bare worklet, is the thinnest path: it opens a Corestore and an Autobase with a Hyperbee view on a device.
- Waits on epic 1 because: the capability ports and the event envelope that the record writes (1.2, 1.3), and the app and Node the spike runs in (1.1).
- Waits on epic 2 because: the identity and UCAN authority that admits writers and checks delegation expiry (2.2, 2.3, 2.4, 2.5).
- Assumption: entries 2 to 9 assume the mobile architecture that spike 1 selects; if spike 1 selects the Node-held-writers fallback, entries 4 and 5 change scope.
- Assumption: entry 6 uses the authority verifier from epic 2 entry 5 inside `apply`, so this entry extends that check with log time rather than duplicating it.
- Open question: the optional Bluetooth spike (entry 9) is in this epic; the user decides whether it stays here or is dropped before the epic starts.
- Assumption: entry 10, a closing Refactor sweep, was added by default because the epic has more than three entries; declining it is a `Decision:` line.
