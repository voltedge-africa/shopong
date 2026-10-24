---
id: 2
type: story
title: "StableRail port and a testnet adapter"
parent: epic-stablecoin-rail-zarp-zarsc
covers: [FR13, NFR5, AR1]
after: [1]
refined: false
hitl: false
risk: high
---

# StableRail port and a testnet adapter

## Description

Implements the StableRail port with a testnet adapter that creates wallets and sends test tokens for the chosen token, with signing keys kept on the OCN Node or with the chosen custody service.

As a builder,  
I want a stablecoin adapter proven on testnet behind the port,  
So that the rail can be used safely once approved.

## Acceptance Criteria

1. **Given** the chosen token on testnet/devnet
   **When** the adapter creates a wallet, receives and sends test tokens
   **Then** it passes the `StableRail` contract suite
   **And** signing keys never leave the OCN Node or the chosen custody service.

## References

- parent — _bmad-output/initiative-ocn/epic-stablecoin-rail-zarp-zarsc/epic-stablecoin-rail-zarp-zarsc.md
- architecture-ocn/architecture-ocn.md#stablecoin-via-zarp-zarsc
