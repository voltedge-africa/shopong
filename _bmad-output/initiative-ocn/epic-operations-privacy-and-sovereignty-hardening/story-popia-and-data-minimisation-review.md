---
id: 3
type: story
title: "POPIA and data-minimisation review"
parent: epic-operations-privacy-and-sovereignty-hardening
covers: [NFR3]
after: [2.7, 3.2]
refined: false
hitl: true
risk: medium
---

# POPIA and data-minimisation review

## Description

Reviews which personal data is stored where and classifies each field by device, commitment, ledger metadata or shared record, with its lawful basis, retention and deletion approach, turning each gap into a new story.

As the product owner,  
I want a review of what personal data is stored where,  
So that we meet POPIA and avoid permanent exposure in append-only logs.

## Acceptance Criteria

1. **Given** the data inventory
   **When** reviewed
   **Then** each field is classified (device only, commitment, ledger metadata, shared record) with its lawful basis, retention and deletion approach
   **And** gaps become stories.

## References

- parent — _bmad-output/initiative-ocn/epic-operations-privacy-and-sovereignty-hardening/epic-operations-privacy-and-sovereignty-hardening.md
- architecture-ocn/architecture-ocn.md#7-security-privacy-and-sovereignty
