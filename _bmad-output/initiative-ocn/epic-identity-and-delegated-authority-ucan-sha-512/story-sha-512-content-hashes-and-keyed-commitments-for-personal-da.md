---
id: 7
type: story
title: "SHA-512 content hashes and keyed commitments for personal data"
parent: epic-identity-and-delegated-authority-ucan-sha-512
covers: [NFR3, AR10]
after: [3, 1.3]
refined: false
hitl: false
risk: high
---

# SHA-512 content hashes and keyed commitments for personal data

## Description

Ensures phone numbers and ID numbers reach the shared record only as HMAC-SHA512 commitments, and that attached files are hashed with SHA-512 so recipients can verify them.

As a member,  
I want my phone number and ID never to be written to the shared record,  
So that my privacy is protected while the group can still match people.

## Acceptance Criteria

1. **Given** a phone number
   **When** the app needs it in the record
   **Then** only `HMAC-SHA512(communitySecret, normalised value)` is stored
   **And** the HMAC comes from an audited library because expo-crypto has no HMAC.
2. **Given** a document or photo
   **When** it is attached
   **Then** its SHA-512 is computed with expo-crypto and stored in the event
   **And** a recipient can re-hash the file and see "verified" or "does not match".

## References

- parent — _bmad-output/initiative-ocn/epic-identity-and-delegated-authority-ucan-sha-512/epic-identity-and-delegated-authority-ucan-sha-512.md
- architecture-ocn/architecture-ocn.md#ad-9
