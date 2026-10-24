---
id: 6
type: story
title: "Pooled funds and member balances view"
parent: epic-pooled-money-ledger-and-payments-ledfra-stitch
covers: [FR10]
after: [2, 5, 3.2]
refined: false
hitl: false
risk: medium
---

# Pooled funds and member balances view

## Description

Members see the pool total, their own contribution, each member's status and the target, read from the ledger, with any mismatch against the record flagged rather than hidden.

As a member,  
I want to see how much is in the pool and what I have contributed,  
So that I can trust the group's money.

## Acceptance Criteria

1. **Given** payments recorded
   **When** I open the pool
   **Then** I see the pool total, my contribution, each member's status and the target, read from the ledger and matched to the record
   **And** a mismatch is flagged rather than hidden.

## References

- parent — _bmad-output/initiative-ocn/epic-pooled-money-ledger-and-payments-ledfra-stitch/epic-pooled-money-ledger-and-payments-ledfra-stitch.md
- architecture-ocn/architecture-ocn.md#de-ledger-via-ledfra
