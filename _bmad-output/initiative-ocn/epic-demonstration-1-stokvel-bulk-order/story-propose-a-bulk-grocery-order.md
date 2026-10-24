---
id: 2
type: story
title: "Propose a bulk grocery order"
parent: epic-demonstration-1-stokvel-bulk-order
covers: [FR6]
after: [1, 2.4]
refined: false
hitl: false
risk: medium
---

# Propose a bulk grocery order

## Description

A member with order/propose submits a bulk order with a list, a budget and a deadline, and the treasurer's approval opens quotes and pledges.

As a member,  
I want to propose a bulk order with a list, a budget and a deadline,  
So that the group can decide together.

## Acceptance Criteria

1. **Given** I hold `order/propose`
   **When** I submit a proposal
   **Then** it appears for all members with the budget per member and the deadline
   **And** the treasurer can approve it to open quotes and pledges.

## References

- parent — _bmad-output/initiative-ocn/epic-demonstration-1-stokvel-bulk-order/epic-demonstration-1-stokvel-bulk-order.md
