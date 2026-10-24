---
id: 6
type: story
title: "Sandbox accounts and fixtures"
parent: epic-walking-skeleton-and-capability-seams
covers: [AR1]
after: [2, 5]
refined: false
hitl: true
risk: low
---

# Sandbox accounts and fixtures

## Description

Provides sandbox credentials for each outside service and recorded request/response fixtures, so tests run without touching real money or data.

As a builder,  
I want sandbox credentials and recorded fixtures for each outside service,  
So that tests run without touching real money or data.

## Acceptance Criteria

1. **Given** the sandbox setup guide
   **When** I follow it
   **Then** I have a Stitch test client, a Ledfra sandbox ledger, a Solana devnet and EVM testnet wallet, a small OSM extract and a set of sample supplier documents
   **And** recorded request/response fixtures exist for the first payment and ledger calls.

## References

- parent — _bmad-output/initiative-ocn/epic-walking-skeleton-and-capability-seams/epic-walking-skeleton-and-capability-seams.md
