---
id: 3
type: story
title: "Compare supplier options"
parent: epic-demonstration-1-stokvel-bulk-order
covers: [FR8]
after: [2, 6.3, 6.5]
refined: false
hitl: false
risk: medium
---

# Compare supplier options

## Description

Members compare reviewed supplier quotes side by side on price per item, totals, delivery terms and the ranked suggestion with its confidence, and the treasurer selects a supplier.

As a member,  
I want to compare supplier quotes side by side,  
So that we choose fairly.

## Acceptance Criteria

1. **Given** reviewed quotes from at least two suppliers
   **When** I open the comparison
   **Then** I see price per item, totals, delivery terms and the ranked suggestion with its confidence
   **And** the treasurer selects a supplier with `quote.selected`.

## References

- parent — _bmad-output/initiative-ocn/epic-demonstration-1-stokvel-bulk-order/epic-demonstration-1-stokvel-bulk-order.md
