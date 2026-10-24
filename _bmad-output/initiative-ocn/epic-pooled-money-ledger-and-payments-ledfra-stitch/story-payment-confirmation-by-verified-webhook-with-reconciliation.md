---
id: 5
type: story
title: "Payment confirmation by verified webhook, with reconciliation"
parent: epic-pooled-money-ledger-and-payments-ledfra-stitch
covers: [FR9, FR10, NFR5, NFR6]
after: [2, 3, 4, 1.3, 1.5, 3.2]
refined: false
hitl: false
risk: high
---

# Payment confirmation by verified webhook, with reconciliation

## Description

Confirms payments only from verified, de-duplicated Stitch webhooks, with a poller that resolves payments whose webhook never arrives and shows webhook replays and failures to the operator.

As a treasurer,  
I want payments confirmed only from verified Stitch webhooks, with a safety net,  
So that nobody is credited for money that did not arrive.

## Acceptance Criteria

1. **Given** a `PaymentInitiationRequestCompleted` webhook
   **When** the Node verifies its signature and de-duplicates by payment id
   **Then** it posts to the ledger and appends a `payment.completed` event.
2. **Given** no webhook arrives before a timeout
   **When** the reconciler polls `node(id)`
   **Then** it resolves the payment's state and records it
   **And** webhook replays and failures are visible to the operator.

## References

- parent — _bmad-output/initiative-ocn/epic-pooled-money-ledger-and-payments-ledfra-stitch/epic-pooled-money-ledger-and-payments-ledfra-stitch.md
- architecture-ocn/architecture-ocn.md#payment-processor-via-stitch
