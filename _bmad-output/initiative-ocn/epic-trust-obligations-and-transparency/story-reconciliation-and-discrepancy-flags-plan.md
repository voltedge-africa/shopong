---
title: "Reconciliation and discrepancy flags"
ticket: 3
status: draft
---

## Story and acceptance criteria

As a treasurer,
I want automatic checks that the record, ledger and payment processor agree,
So that problems are caught early.

**Acceptance Criteria:**

**Given** a scheduled reconciliation  
**When** a total or a status differs between systems  
**Then** a discrepancy is created with both values and the event id  
**And** it is visible to approvers until resolved with a recorded reason.  
