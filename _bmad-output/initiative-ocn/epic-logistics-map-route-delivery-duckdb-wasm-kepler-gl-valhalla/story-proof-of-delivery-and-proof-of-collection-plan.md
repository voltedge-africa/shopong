---
title: "Proof of delivery and proof of collection"
ticket: 6
status: draft
---

## Story and acceptance criteria

As a treasurer,
I want delivery and collection confirmed with proof,
So that the supplier is released and members know goods arrived.

**Acceptance Criteria:**

**Given** a driver with `delivery/confirm`  
**When** they confirm arrival  
**Then** a signed event with time, coarse location and a photo (SHA-512 in Hyperdrive) is recorded.  

**Given** a member collects their share  
**When** they confirm  
**Then** a `collection.confirmed` event is recorded and the order shows progress.  
