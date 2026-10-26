# Decision 3.1: the OCN Node holds the record's writers (Demonstration 1)

**Status:** accepted by the product owner on 2026-10-26. The on-phone design is not rejected; it is deferred.
**Story:** 3.1 (spike: Hypercore stack in a Bare worklet inside Expo)
**Evidence:** `docs/spike-findings.md` (spike 3.1) and the original spike code, `git show 9de4e48:spikes/3-1-bare-worklet/results/README.md`.

## Question

Where do the Corestore, Autobase, Hyperbee and Hyperdrive pieces of a community's shared record run: inside a Bare worklet on each phone, or on the OCN Node with phones connecting to it?

## What the evidence shows

- The whole stack ran in Bare 1.33.4 **on Linux only**: writer admission, offline divergence converging with no lost events, replication, `signedLength` advancing on ack, identical views in every arrival order, and AD-18 recovery from a seed (needs `unsafe: true`, a plaintext primary key at rest, and a pre-sync before opening Autobase).
- **Nothing ran on a phone or inside Expo.** The 10,000-event throughput test timed out, so there is no throughput number. Risk R-1 is not retired.
- Running it on Android needs a development build (Expo Go cannot load `react-native-bare-kit`), `bare-pack` and `bare-link` for each architecture, and `cmake`, which is not installed here. That is a multi-day task. The emulator is x86_64, so it would still not stand in for the low-end arm64 phone the ticket's budget asks about, and iOS needs an iPhone.

## Decision

**For Demonstration 1 the OCN Node holds each community's Autobase and the writer keys of its members** (the architecture's own fallback, AD-14 and risk R-1). Phones connect to the Node over an authenticated connection, keep their writes on the phone while offline, and sync when back online. The on-phone Bare worklet design stays a later spike behind the same `SharedRecord` port, so switching later is a new adapter that passes the same contract suite.

## What changes

- Epic 3 stories 3.3, 3.4, 3.5 and 3.7 were re-described (writers held by the Node, phones sync to it, the Node holds the files). 3.4 now waits on 3.5.
- The `SharedRecord` port and its contract suite do not change. The community `apply` we built runs on the Node's Autobase unchanged.

## Risks and what was not tested

- Phones depend on the Node being reachable to sync; direct phone-to-phone sync does not exist for Demonstration 1. This is weaker on digital sovereignty than the original design.
- The Node becomes the single place a community's writer keys live, so its security and backups matter (epic 12).
- Not tested: Hyper stack on any phone, iOS, battery, start-up time, memory.

## Exit path

Build the on-phone adapter (`react-native-bare-kit` worklet) as a spike branch, run it on a real low-end Android and an iPhone, and swap it in behind the `SharedRecord` port.
