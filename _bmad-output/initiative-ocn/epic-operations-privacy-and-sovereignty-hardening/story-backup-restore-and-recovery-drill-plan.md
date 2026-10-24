---
title: "Backup, restore and recovery drill"
ticket: 2
status: draft
---

## Story and acceptance criteria

As an operator,
I want tested backup and restore for keys, the record and the ledger mapping,
So that losing a device or a server is survivable.

**Acceptance Criteria:**

**Given** a space with history  
**When** I restore the Node on new hardware and a member recovers on a new phone  
**Then** the record, the member's identity and balances match the originals  
**And** the ledger can be rebuilt from mirrored record events and matches Ledfra.  
