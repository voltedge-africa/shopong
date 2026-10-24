---
id: 4
type: spike
title: "Stitch disbursements, auth and webhook verification"
parent: epic-pooled-money-ledger-and-payments-ledfra-stitch
covers: [FR11, NFR5, AR3]
after: [1.6]
refined: false
hitl: false
risk: high
---

# Stitch disbursements, auth and webhook verification

## Description

Confirms Stitch's payout API, client-credentials flow, webhook signature method and settlement times through the IDE, Postman collection and a test disbursement, recording any changes needed to stories 4.5 to 4.7.

As a builder,  
I want to confirm Stitch's payout API, client-credentials flow, webhook signature method and settlement times,  
So that we can design pay-out and reconciliation correctly.

## Acceptance Criteria

1. **Given** the Stitch IDE, Postman collection and docs
   **When** I run the client-credentials flow and a test disbursement
   **Then** I record the endpoints, scopes, limits, signature verification method and settlement times.
2. **Given** the findings
   **When** compared with architecture assumptions
   **Then** a decision record lists any change to stories 4.5-4.7.

## References

- parent — _bmad-output/initiative-ocn/epic-pooled-money-ledger-and-payments-ledfra-stitch/epic-pooled-money-ledger-and-payments-ledfra-stitch.md
- architecture-ocn/architecture-ocn.md#payment-processor-via-stitch
