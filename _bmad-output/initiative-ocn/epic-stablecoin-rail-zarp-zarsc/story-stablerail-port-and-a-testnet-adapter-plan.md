---
title: "StableRail port and a testnet adapter"
ticket: 2
status: draft
---

## Story and acceptance criteria

As a builder,
I want a stablecoin adapter proven on testnet behind the port,
So that the rail can be used safely once approved.

**Acceptance Criteria:**

**Given** the chosen token on testnet/devnet  
**When** the adapter creates a wallet, receives and sends test tokens  
**Then** it passes the `StableRail` contract suite  
**And** signing keys never leave the OCN Node or the chosen custody service.  
