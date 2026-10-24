---
id: 5
type: story
title: "Approve and pay the supplier"
parent: epic-demonstration-1-stokvel-bulk-order
covers: [FR11]
after: [4, 4.7]
refined: false
hitl: false
risk: high
---

# Approve and pay the supplier

## Description

Once the pool is funded and the required approvers agree, the supplier is paid and every member sees supplier paid, with the ledger and the record in agreement.

As a treasurer,  
I want the supplier paid once the pool is funded and approvers agree,  
So that the order is placed.

## Acceptance Criteria

1. **Given** a funded pool and the required approvals
   **When** payment executes
   **Then** the supplier is paid, the ledger and the record agree and every member sees "supplier paid".

## References

- parent — _bmad-output/initiative-ocn/epic-demonstration-1-stokvel-bulk-order/epic-demonstration-1-stokvel-bulk-order.md
- architecture-ocn/architecture-ocn.md#ad-3
