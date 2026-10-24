---
id: 2
type: story
title: "Find suppliers and stock offers"
parent: epic-demonstration-2-small-retailer-stock-and-funding
covers: [FR18]
after: [1, 6.2]
refined: false
hitl: false
risk: medium
---

# Find suppliers and stock offers

## Description

A retailer searches a supplier circle's published offers by item and sees each offer with its price history and the supplier's delivery record.

As a retailer,  
I want to see suppliers and their current offers,  
So that I can restock at the best price.

## Acceptance Criteria

1. **Given** a supplier circle with published offers
   **When** I search by item
   **Then** I see offers, price history (DuckDB) and each supplier's delivery record.

## References

- parent — _bmad-output/initiative-ocn/epic-demonstration-2-small-retailer-stock-and-funding/epic-demonstration-2-small-retailer-stock-and-funding.md
- architecture-ocn/architecture-ocn.md#ad-5
