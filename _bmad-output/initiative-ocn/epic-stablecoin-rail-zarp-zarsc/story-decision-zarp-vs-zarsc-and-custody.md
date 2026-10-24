---
id: 1
type: story
title: "Decision: ZARP vs ZARsc and custody"
parent: epic-stablecoin-rail-zarp-zarsc
covers: [FR13, AR3]
after: []
refined: false
hitl: true
risk: high
---

# Decision: ZARP vs ZARsc and custody

## Description

Compares ZARP and ZARsc on regulation, mint and redeem, API access, fees and custody from issuer documents and written answers, and records decision D-1 with its custody model after legal review.

As the product owner,  
I want a written comparison of ZARP and ZARsc covering regulation, mint/redeem, API access, fees and custody,  
So that I can choose one, both or neither.

## Acceptance Criteria

1. **Given** the issuers' documentation and written answers from each issuer
   **When** compared
   **Then** the record covers CASP/FSCA position, entity and licence scope, latest reserve attestation, Token-2022 extensions on the ZARsc mint, contract controls (freeze/blacklist/upgrade) on ZARP, mint/redeem rails, fees and developer access.
2. **Given** the comparison
   **When** reviewed with legal input
   **Then** decision D-1 is recorded as proceed, defer or drop, with the custody model.

## References

- parent — _bmad-output/initiative-ocn/epic-stablecoin-rail-zarp-zarsc/epic-stablecoin-rail-zarp-zarsc.md
- architecture-ocn/architecture-ocn.md#stablecoin-via-zarp-zarsc
- architecture-ocn/architecture-ocn.md#9-decisions
