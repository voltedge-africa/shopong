---
title: "Create my identity on this device"
ticket: 2
status: draft
---

## Story and acceptance criteria

As a community member,
I want to create an identity that lives only on my phone,
So that I own who I am in the network.

**Acceptance Criteria:**

**Given** a fresh install  
**When** I choose "Create my identity"  
**Then** an Ed25519 keypair and `did:key` are created and the private key is stored in secure storage  
**And** the public DID is shown with a short readable form.  

**Given** the app is reinstalled without a backup  
**When** I open it  
**Then** it does not pretend to know my old identity and offers recovery (story 2.6).  
