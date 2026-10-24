---
title: "Shared event envelope and canonical hashing"
ticket: 3
status: done
---

## Story and acceptance criteria

As a builder,
I want one versioned event envelope with canonical serialisation and an event id,
So that the record, ledger and payments all reconcile on the same value.

**Acceptance Criteria:**

**Given** an event `{v, type, space, actor, proof, claimedAt, nonce, payload}`  
**When** it is serialised twice on different platforms  
**Then** the canonical bytes and the SHA-512 event id are identical.  

**Given** an event with an unknown `type` or higher `v`  
**When** it is parsed  
**Then** it is preserved and ignored by older readers without error.  
