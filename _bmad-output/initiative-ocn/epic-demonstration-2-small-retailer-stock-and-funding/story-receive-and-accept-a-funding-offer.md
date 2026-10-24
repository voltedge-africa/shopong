---
id: 4
type: story
title: "Receive and accept a funding offer"
parent: epic-demonstration-2-small-retailer-stock-and-funding
covers: [FR19, FR20]
after: [3, 4.2]
refined: false
hitl: false
risk: high
---

# Receive and accept a funding offer

## Description

A retailer compares funding offers and accepts one, which creates an obligation with amount, due date and repayment schedule, plus ledger receivable and payable accounts for both parties.

As a retailer,  
I want to compare and accept funding offers,  
So that terms are clear before I commit.

## Acceptance Criteria

1. **Given** one or more offers
   **When** I accept one
   **Then** a `funding.accepted` event creates an obligation (amount, due date, repayment schedule) and ledger receivable and payable accounts for both parties.

## References

- parent — _bmad-output/initiative-ocn/epic-demonstration-2-small-retailer-stock-and-funding/epic-demonstration-2-small-retailer-stock-and-funding.md
- architecture-ocn/architecture-ocn.md#ad-8
