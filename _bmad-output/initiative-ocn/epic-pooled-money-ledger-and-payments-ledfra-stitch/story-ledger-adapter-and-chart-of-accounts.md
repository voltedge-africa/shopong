---
id: 2
type: story
title: "Ledger adapter and chart of accounts"
parent: epic-pooled-money-ledger-and-payments-ledfra-stitch
covers: [FR10, FR12, NFR6, AR5, AR6]
after: [1, 1.2, 1.3, 1.5, 1.6, 3.2]
refined: false
hitl: false
risk: high
---

# Ledger adapter and chart of accounts

## Description

Implements the Ledger port with the Ledfra adapter so each event becomes one balanced transaction keyed by its event id, with member accounts guarded against overdraw and repeat posts creating no second transaction.

As a treasurer,  
I want my community's money recorded in proper books,  
So that balances and statements can be trusted.

## Acceptance Criteria

1. **Given** the `Ledger` port and the Ledfra adapter
   **When** the Node posts a transaction for an event
   **Then** it is one balanced transaction with `Idempotency-Key = event id` and metadata `{eventSha512, spaceKey}`
   **And** member accounts are guarded so refunds cannot overdraw.
2. **Given** the same event is posted twice
   **When** Ledfra responds
   **Then** no second transaction exists and the Node records the idempotent replay.

## References

- parent — _bmad-output/initiative-ocn/epic-pooled-money-ledger-and-payments-ledfra-stitch/epic-pooled-money-ledger-and-payments-ledfra-stitch.md
- architecture-ocn/architecture-ocn.md#de-ledger-via-ledfra
