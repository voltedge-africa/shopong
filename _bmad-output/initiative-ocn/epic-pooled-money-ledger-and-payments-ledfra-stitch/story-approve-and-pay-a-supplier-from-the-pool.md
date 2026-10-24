---
id: 7
type: story
title: "Approve and pay a supplier from the pool"
parent: epic-pooled-money-ledger-and-payments-ledfra-stitch
covers: [FR11, NFR6, UX-DR2]
after: [2, 3, 4, 5, 2.4, 3.2, 3.3]
refined: false
hitl: false
risk: high
---

# Approve and pay a supplier from the pool

## Description

The pool pays a supplier once the required number of payment/approve holders approve within their ceilings, and a missing approval or exceeded ceiling refuses the payment and shows the reason.

As a treasurer,  
I want the pool to pay the supplier once enough approvers agree,  
So that money moves only with the group's consent.

## Acceptance Criteria

1. **Given** a selected quote and a funded pool
   **When** the required number of `payment/approve` holders approve within their ceilings
   **Then** the Node calls the Stitch payout, records `payment.requested` and later `payment.completed`, and posts a balanced ledger transaction.
2. **Given** a missing approval or an exceeded ceiling
   **When** payment is attempted
   **Then** it is refused and the reason is shown.

## References

- parent — _bmad-output/initiative-ocn/epic-pooled-money-ledger-and-payments-ledfra-stitch/epic-pooled-money-ledger-and-payments-ledfra-stitch.md
- architecture-ocn/architecture-ocn.md#payment-processor-via-stitch
