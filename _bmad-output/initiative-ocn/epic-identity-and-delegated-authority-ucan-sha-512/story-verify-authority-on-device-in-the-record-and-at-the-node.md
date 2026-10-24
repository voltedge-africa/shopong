---
id: 5
type: story
title: "Verify authority on device, in the record and at the Node"
parent: epic-identity-and-delegated-authority-ucan-sha-512
covers: [FR3]
after: [1, 4, 1.2, 1.3]
refined: false
hitl: false
risk: high
---

# Verify authority on device, in the record and at the Node

## Description

Checks every action's authority in three places (on the device, in the record's apply and at the Node) so a forged or stale authorisation cannot cause a real-world effect, and verification works offline.

As an operator,  
I want every action's authority checked in three places,  
So that a forged or stale authorisation cannot cause a real-world effect.

## Acceptance Criteria

1. **Given** an event with a tampered or missing proof
   **When** it is evaluated on the device, in `apply` and at the Node
   **Then** all three refuse it and record why.
2. **Given** a valid chain
   **When** evaluated offline
   **Then** it verifies without any network call.

## References

- parent — _bmad-output/initiative-ocn/epic-identity-and-delegated-authority-ucan-sha-512/epic-identity-and-delegated-authority-ucan-sha-512.md
- architecture-ocn/architecture-ocn.md#ad-6
