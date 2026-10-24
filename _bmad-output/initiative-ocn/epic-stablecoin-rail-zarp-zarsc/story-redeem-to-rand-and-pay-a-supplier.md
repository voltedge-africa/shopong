---
id: 4
type: story
title: "Redeem to Rand and pay a supplier"
parent: epic-stablecoin-rail-zarp-zarsc
covers: [FR13]
after: [3, 4.2, 4.4, 4.7]
refined: false
hitl: false
risk: high
---

# Redeem to Rand and pay a supplier

## Description

Turns stablecoin back into Rand through the approved path and pays the supplier through the Stitch payout, leaving failed redemptions visible and recoverable.

As a treasurer,  
I want to turn stablecoin back into Rand to pay a supplier,  
So that the rail ends in money suppliers can use.

## Acceptance Criteria

1. **Given** stablecoin in the treasury
   **When** I redeem through the approved path
   **Then** the redemption is recorded, the ledger is updated, and the supplier payment proceeds through the Stitch payout
   **And** failures leave the funds visible and recoverable.

## References

- parent — _bmad-output/initiative-ocn/epic-stablecoin-rail-zarp-zarsc/epic-stablecoin-rail-zarp-zarsc.md
- architecture-ocn/architecture-ocn.md#stablecoin-via-zarp-zarsc
- architecture-ocn/architecture-ocn.md#payment-processor-via-stitch
