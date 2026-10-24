---
title: "Ledger adapter and chart of accounts"
ticket: 2
status: draft
---

## Story and acceptance criteria

As a treasurer,
I want my community's money recorded in proper books,
So that balances and statements can be trusted.

**Acceptance Criteria:**

**Given** the `Ledger` port and the Ledfra adapter  
**When** the Node posts a transaction for an event  
**Then** it is one balanced transaction with `Idempotency-Key = event id` and metadata `{eventSha512, spaceKey}`  
**And** member accounts are guarded so refunds cannot overdraw.  

**Given** the same event is posted twice  
**When** Ledfra responds  
**Then** no second transaction exists and the Node records the idempotent replay.  
