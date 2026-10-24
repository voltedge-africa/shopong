---
id: 2
type: story
title: "Transparent transaction timeline"
parent: epic-trust-obligations-and-transparency
covers: [FR21]
after: [3.2, 4.2, 4.5]
refined: false
hitl: false
risk: medium
---

# Transparent transaction timeline

## Description

Joins record events, ledger postings and any on-chain proof for each transaction by event id into one timeline that each participant can read.

As a member,  
I want one timeline for each transaction showing record events, ledger postings and any on-chain proof,  
So that I can see exactly what happened.

## Acceptance Criteria

1. **Given** a payment
   **When** I open it
   **Then** I see the request, confirmation, ledger posting and (if used) transaction link in order, joined by event id.

## References

- parent — _bmad-output/initiative-ocn/epic-trust-obligations-and-transparency/epic-trust-obligations-and-transparency.md
