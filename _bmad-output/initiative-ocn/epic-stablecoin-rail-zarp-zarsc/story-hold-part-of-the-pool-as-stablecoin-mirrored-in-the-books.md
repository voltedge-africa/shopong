---
id: 3
type: story
title: "Hold part of the pool as stablecoin, mirrored in the books"
parent: epic-stablecoin-rail-zarp-zarsc
covers: [FR13]
after: [1, 2, 4.2, 4.6, 4.7]
refined: false
hitl: false
risk: high
---

# Hold part of the pool as stablecoin, mirrored in the books

## Description

Converts part of the pool to stablecoin after the required approvals, stores the transaction signature in the event, mirrors the move in a balanced ledger entry, and shows both balances with an on-chain proof link in the pool view.

As a treasurer,  
I want some pooled funds held as stablecoin and shown alongside the rest,  
So that members see all funds in one place.

## Acceptance Criteria

1. **Given** a conversion approved by the required approvers
   **When** it executes
   **Then** the transaction signature is stored in the event and a balanced ledger entry moves value between `assets:bank/pool` and `assets:wallet/stable`
   **And** the pool view shows both with the on-chain proof link.

## References

- parent — _bmad-output/initiative-ocn/epic-stablecoin-rail-zarp-zarsc/epic-stablecoin-rail-zarp-zarsc.md
- architecture-ocn/architecture-ocn.md#stablecoin-via-zarp-zarsc
- architecture-ocn/architecture-ocn.md#de-ledger-via-ledfra
