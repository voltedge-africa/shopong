---
id: 3
type: story
title: "Shared event envelope and canonical hashing"
parent: epic-walking-skeleton-and-capability-seams
covers: [AR4, AR5]
after: [1, 2]
refined: false
hitl: false
risk: high
---

# Shared event envelope and canonical hashing

## Description

Introduces one versioned event envelope with canonical serialisation and a SHA-512 event id, so the record, ledger and payments reconcile on the same value, and preserves unknown types or higher versions for older readers.

As a builder,  
I want one versioned event envelope with canonical serialisation and an event id,  
So that the record, ledger and payments all reconcile on the same value.

## Acceptance Criteria

1. **Given** an event `{v, type, space, actor, proof, claimedAt, nonce, payload}`
   **When** it is serialised twice on different platforms
   **Then** the canonical bytes and the SHA-512 event id are identical.
2. **Given** an event with an unknown `type` or higher `v`
   **When** it is parsed
   **Then** it is preserved and ignored by older readers without error.

## References

- parent — _bmad-output/initiative-ocn/epic-walking-skeleton-and-capability-seams/epic-walking-skeleton-and-capability-seams.md
- architecture-ocn/architecture-ocn.md#ad-4
- architecture-ocn/architecture-ocn.md#6-data-and-identifiers
