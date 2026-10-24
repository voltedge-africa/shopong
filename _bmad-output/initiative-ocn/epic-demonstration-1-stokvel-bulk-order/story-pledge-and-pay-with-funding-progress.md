---
id: 4
type: story
title: "Pledge and pay, with funding progress"
parent: epic-demonstration-1-stokvel-bulk-order
covers: [FR9, UX-DR1]
after: [3, 4.3]
refined: false
hitl: false
risk: high
---

# Pledge and pay, with funding progress

## Description

Members commit and pay their share through Stitch, moving from requested to paid, while the funding bar updates for everyone and unpaid members show as unpaid without bank details.

As a member,  
I want to commit my share and pay it,  
So that the order can go ahead.

## Acceptance Criteria

1. **Given** a selected quote
   **When** I pledge and pay through Stitch
   **Then** my status moves requested to paid and the funding bar updates for everyone
   **And** an unpaid member is shown as such without exposing bank details.

## References

- parent — _bmad-output/initiative-ocn/epic-demonstration-1-stokvel-bulk-order/epic-demonstration-1-stokvel-bulk-order.md
- architecture-ocn/architecture-ocn.md#ad-13
