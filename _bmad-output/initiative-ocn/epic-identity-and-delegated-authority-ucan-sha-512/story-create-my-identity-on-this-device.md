---
id: 2
type: story
title: "Create my identity on this device"
parent: epic-identity-and-delegated-authority-ucan-sha-512
covers: [FR1]
after: [1, 1.1]
refined: false
hitl: false
risk: high
---

# Create my identity on this device

## Description

A person creates an Ed25519 identity (did:key) that lives only on their phone with its private key in secure storage, and a reinstall without a backup does not pretend to recover the old identity.

As a community member,  
I want to create an identity that lives only on my phone,  
So that I own who I am in the network.

## Acceptance Criteria

1. **Given** a fresh install
   **When** I choose "Create my identity"
   **Then** an Ed25519 keypair and `did:key` are created and the private key is stored in secure storage
   **And** the public DID is shown with a short readable form.
2. **Given** the app is reinstalled without a backup
   **When** I open it
   **Then** it does not pretend to know my old identity and offers recovery (story 2.6).

## References

- parent — _bmad-output/initiative-ocn/epic-identity-and-delegated-authority-ucan-sha-512/epic-identity-and-delegated-authority-ucan-sha-512.md
- architecture-ocn/architecture-ocn.md#6-data-and-identifiers
