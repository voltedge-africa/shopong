---
id: 4
type: story
title: "Roles with limits as delegated capabilities"
parent: epic-identity-and-delegated-authority-ucan-sha-512
covers: [FR3]
after: [2, 3]
refined: false
hitl: false
risk: high
---

# Roles with limits as delegated capabilities

## Description

Treasurers grant roles such as co-treasurer, driver or supplier with limits, so holders act only within those limits and the role's expiry, and delegations wider or higher than the holder's own are refused.

As a treasurer,  
I want to grant roles such as co-treasurer, driver or supplier with limits,  
So that people can act for the group only as far as I allow.

## Acceptance Criteria

1. **Given** I hold `payment/approve` with a ceiling
   **When** I delegate it to another member with a lower ceiling
   **Then** the delegation is accepted
   **And** a delegation with a higher ceiling or a wider resource is rejected by the attenuation rules.
2. **Given** a delegated role has an expiry
   **When** the expiry passes
   **Then** the holder can no longer act and the app says why.

## References

- parent — _bmad-output/initiative-ocn/epic-identity-and-delegated-authority-ucan-sha-512/epic-identity-and-delegated-authority-ucan-sha-512.md
- architecture-ocn/architecture-ocn.md#ad-6
