---
type: epic
title: "Walking skeleton and capability seams"
parent: initiative-ocn
covers: [AR1, AR2, AR4, AR5, NFR5, NFR7]
assignee: ""
status: in-progress
risk: high
---

# Walking skeleton and capability seams

## Description

A builder can run Shopong on iOS, Android and web against in-memory adapters and watch a scripted stokvel order go from proposal to collection, with every technology behind a port that has a contract test suite. This makes every later epic additive instead of a rewrite.

## Outcome

Builders and stokvel treasurers can see a whole bulk order run through the app on in-memory adapters, and the signal is an end-to-end test that asserts the same proposal-to-collection sequence.

## Requirements

- AR1: Every third-party technology sits behind a port with a contract test suite and an in-memory adapter (architecture AD-1).
- AR2: Versions are pinned, notably DuckDB-WASM (the docs and the npm `latest` tag disagree).
- AR4: The shared record uses one versioned event envelope; one Autobase per community space with a Hyperbee view and Hyperdrive for files (AD-2).
- AR5: The OCN Node is the only writer to Ledfra, Stitch and the stablecoin adapter (AD-3); the event id is the idempotency and reconciliation key (AD-4).
- NFR5: Secrets (payment, ledger, LLM keys) exist only on the OCN Node; webhooks are signature-verified and replay-safe; agents run in a sandbox.
- NFR7: Operators can see replication lag, webhook failures, queue depth and reconciliation status.

## Done when

1. A fresh clone of Shopong opens to the signed-out home screen on the iOS simulator, the Android emulator and the web, and the OCN Node reports healthy on its local port.
2. A seeded five-member stokvel's scripted order shows proposed, pledges received, supplier paid, delivery planned and collection confirmed, in that order, on in-memory adapters.
3. Every capability port in the shared package has an in-memory adapter that passes its contract suite.
4. The OCN Node refuses to start when a required secret is missing, names the key, and prints no secret value.
5. The same event serialises to identical canonical bytes and the same SHA-512 event id on two platforms.

## Boundaries

The platform baseline: the Shopong app shell, the OCN Node service, the shared package, CI, the capability ports with in-memory adapters, the event envelope, and sandbox fixtures. It is not a real third-party integration (Ledfra, Stitch and the stablecoin rail belong to epics 4 and 5), not identity or UCAN (epic 2, identity and delegated authority), and not the Autobase-backed shared record (epic 3).

## References

- parent — ../initiative-ocn.md, the epic list
- spec — ../spec-ocn/spec-ocn.md, Requirements Inventory (AR1, AR2, AR4, AR5, NFR5, NFR7)
- constraint — ../architecture-ocn/architecture-ocn.md, section 3.2 Ports and adapters (AD-1)
- constraint — ../architecture-ocn/architecture-ocn.md, section 9 Decisions (AD-3: the OCN Node is the only writer holding credentials)
- input — the acceptance criteria of each story are in its `*-plan.md` file in this folder

## Notes

- Tracer: entry 1 (the runnable app shell and CI) is the thinnest path: it touches the app, the Node and CI, with no port or external system yet.
- Assumption: the tracer (entry 4) delivers the shape of FR6, FR9, FR11 and FR16 on in-memory adapters only; epic 8 owns those FRs for real.
- Assumption: entry 3 waits on entry 2 because both change the shared package, so they would collide if run in parallel.
- Assumption: entry 7, a closing Refactor sweep, was added by default because the epic has more than three entries; declining it is a `Decision:` line.
