---
id: 6
type: story
title: "Deterministic capability checks in `apply` using log time"
parent: epic-shared-community-record-hyper-stack
covers: [NFR4]
after: [2, 2.4, 2.5]
refined: false
hitl: false
risk: high
---

# Deterministic capability checks in `apply` using log time

## Description

Evaluates UCAN expiry and revocation against log time (the highest accepted claimedAt) rather than the device clock, so every peer reaches the same result, and later events that use a revoked capability are refused.

As a builder,  
I want expiry and revocation evaluated from the log itself,  
So that every peer reaches the same view.

## Acceptance Criteria

1. **Given** a UCAN with an expiry
   **When** `apply` evaluates it
   **Then** it compares against log time (the highest accepted `claimedAt`), not `Date.now()`
   **And** replays on a later date produce the same result.
2. **Given** a `role.revoked` event
   **When** a later event uses the revoked capability
   **Then** `apply` rejects the later event and records it as refused.

## References

- parent — _bmad-output/initiative-ocn/epic-shared-community-record-hyper-stack/epic-shared-community-record-hyper-stack.md
