---
id: 2
type: story
title: "Capability ports and the contract test suite"
parent: epic-walking-skeleton-and-capability-seams
covers: [AR1]
after: [1]
refined: false
hitl: false
risk: medium
---

# Capability ports and the contract test suite

## Description

Defines typed ports for each capability with a documented interface and an in-memory adapter, plus a shared contract test suite that any adapter, real or fake, must pass.

As a builder,  
I want typed ports for each capability with a shared contract test suite,  
So that any adapter, real or fake, is proven to behave the same way.

## Acceptance Criteria

1. **Given** the ports `CapabilityAuth`, `SharedRecord`, `Ledger`, `PayIn`, `PayOut`, `StableRail`, `Ocr`, `Decide`, `Routing`, `Geo`, `Agent`, `GenUi`
   **When** I read the shared package
   **Then** each port has a documented interface and an in-memory adapter.
2. **Given** a port's contract suite
   **When** I run it against the in-memory adapter
   **Then** it passes
   **And** the suite can be pointed at a real adapter later without edits.

## References

- parent — _bmad-output/initiative-ocn/epic-walking-skeleton-and-capability-seams/epic-walking-skeleton-and-capability-seams.md
