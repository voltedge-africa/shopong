---
id: 8
type: story
title: "Refunds, shortfalls and partial funding"
parent: epic-pooled-money-ledger-and-payments-ledfra-stitch
covers: [FR10, FR12, UX-DR1]
after: [2, 5, 6, 3.2]
refined: false
hitl: false
risk: high
---

# Refunds, shortfalls and partial funding

## Description

Handles cancelled orders by refunding each member with per-member events and compensating ledger entries, and records the treasurer's choice when the pool falls short, with members seeing the effect on their share.

As a treasurer,  
I want clear handling when the pool falls short or an order is cancelled,  
So that no member loses track of their money.

## Acceptance Criteria

1. **Given** an order cancelled before supplier payment
   **When** I choose "refund all"
   **Then** refund events and compensating ledger entries are created per member and each shows its state.
2. **Given** a shortfall at the deadline
   **When** I choose to proceed with a smaller order or extend
   **Then** the choice is recorded and members see the effect on their share.

## References

- parent — _bmad-output/initiative-ocn/epic-pooled-money-ledger-and-payments-ledfra-stitch/epic-pooled-money-ledger-and-payments-ledfra-stitch.md
- architecture-ocn/architecture-ocn.md#de-ledger-via-ledfra
