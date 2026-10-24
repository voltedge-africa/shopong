---
id: 3
type: story
title: "Pay my contribution by bank payment"
parent: epic-pooled-money-ledger-and-payments-ledfra-stitch
covers: [FR9, UX-DR1]
after: [2, 1.2, 1.3, 1.5, 1.6, 3.2]
refined: false
hitl: false
risk: high
---

# Pay my contribution by bank payment

## Description

A member taps Pay on a pledge and completes it in their own banking app through a Stitch payment request with card disabled, and returning to the app shows waiting for confirmation rather than paid.

As a member,  
I want to pay my share from my own banking app,  
So that I do not need cash or a new account.

## Acceptance Criteria

1. **Given** I pledged an amount
   **When** I tap "Pay"
   **Then** the Node creates a Stitch payment request with `externalReference` = event id and the app opens the returned URL in an in-app browser tab
   **And** card is disabled and the redirect domain is allow-listed HTTPS.
2. **Given** I complete the payment
   **When** I return to the app
   **Then** it shows "waiting for confirmation" and does not mark the payment paid from redirect parameters alone.

## References

- parent — _bmad-output/initiative-ocn/epic-pooled-money-ledger-and-payments-ledfra-stitch/epic-pooled-money-ledger-and-payments-ledfra-stitch.md
- architecture-ocn/architecture-ocn.md#payment-processor-via-stitch
