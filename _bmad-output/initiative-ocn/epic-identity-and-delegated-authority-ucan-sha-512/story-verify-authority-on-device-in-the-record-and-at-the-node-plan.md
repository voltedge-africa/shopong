---
title: "Verify authority on device, in the record and at the Node"
ticket: 5
status: draft
---

## Story and acceptance criteria

As an operator,
I want every action's authority checked in three places,
So that a forged or stale authorisation cannot cause a real-world effect.

**Acceptance Criteria:**

**Given** an event with a tampered or missing proof  
**When** it is evaluated on the device, in `apply` and at the Node  
**Then** all three refuse it and record why.  

**Given** a valid chain  
**When** evaluated offline  
**Then** it verifies without any network call.  
