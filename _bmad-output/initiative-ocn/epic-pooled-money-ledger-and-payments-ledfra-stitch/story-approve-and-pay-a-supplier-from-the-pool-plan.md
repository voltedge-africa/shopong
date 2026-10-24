---
title: "Approve and pay a supplier from the pool"
ticket: 7
status: draft
---

## Story and acceptance criteria

As a treasurer,
I want the pool to pay the supplier once enough approvers agree,
So that money moves only with the group's consent.

**Acceptance Criteria:**

**Given** a selected quote and a funded pool  
**When** the required number of `payment/approve` holders approve within their ceilings  
**Then** the Node calls the Stitch payout, records `payment.requested` and later `payment.completed`, and posts a balanced ledger transaction.  

**Given** a missing approval or an exceeded ceiling  
**When** payment is attempted  
**Then** it is refused and the reason is shown.  
