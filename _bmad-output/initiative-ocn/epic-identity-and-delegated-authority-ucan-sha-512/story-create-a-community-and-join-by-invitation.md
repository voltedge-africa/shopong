---
id: 3
type: story
title: "Create a community and join by invitation"
parent: epic-identity-and-delegated-authority-ucan-sha-512
covers: [FR2]
after: [2, 1.2, 1.3]
refined: false
hitl: false
risk: high
---

# Create a community and join by invitation

## Description

A treasurer creates a community and invites members with a link or single-use code carrying a short-lived invitation UCAN, and newcomers join with offline verification while expired or reused invitations are rejected.

As a treasurer,  
I want to create a community and invite members with a link or code,  
So that only people I invite can join.

## Acceptance Criteria

1. **Given** I created the community
   **When** I invite someone
   **Then** an invitation UCAN is issued for their DID or an open single-use code, with a short expiry and `member/join`.
2. **Given** a newcomer presents a valid invitation
   **When** they join
   **Then** the join is verified offline and recorded as a `member.joined` event
   **And** an expired or reused invitation is rejected with a clear reason.

## References

- parent — _bmad-output/initiative-ocn/epic-identity-and-delegated-authority-ucan-sha-512/epic-identity-and-delegated-authority-ucan-sha-512.md
- architecture-ocn/architecture-ocn.md#41-identity-who-may-do-what
