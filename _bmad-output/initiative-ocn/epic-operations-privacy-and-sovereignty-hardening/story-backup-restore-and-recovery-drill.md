---
id: 2
type: story
title: "Backup, restore and recovery drill"
parent: epic-operations-privacy-and-sovereignty-hardening
covers: [FR28]
after: [1, 2.6, 3.5, 4.2]
refined: false
hitl: true
risk: high
---

# Backup, restore and recovery drill

## Description

Tests restoring the Node on new hardware, a member recovering on a new phone, and rebuilding the ledger from mirrored record events, and checks that the results match the originals.

As an operator,  
I want tested backup and restore for keys, the record and the ledger mapping,  
So that losing a device or a server is survivable.

## Acceptance Criteria

1. **Given** a space with history
   **When** I restore the Node on new hardware and a member recovers on a new phone
   **Then** the record, the member's identity and balances match the originals
   **And** the ledger can be rebuilt from mirrored record events and matches Ledfra.

## References

- parent — _bmad-output/initiative-ocn/epic-operations-privacy-and-sovereignty-hardening/epic-operations-privacy-and-sovereignty-hardening.md
- architecture-ocn/architecture-ocn.md#ad-8
- architecture-ocn/architecture-ocn.md#ad-18
