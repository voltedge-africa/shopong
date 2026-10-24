---
title: "Refunds, shortfalls and partial funding"
ticket: 8
status: draft
---

## Story and acceptance criteria

As a treasurer,
I want clear handling when the pool falls short or an order is cancelled,
So that no member loses track of their money.

**Acceptance Criteria:**

**Given** an order cancelled before supplier payment  
**When** I choose "refund all"  
**Then** refund events and compensating ledger entries are created per member and each shows its state.  

**Given** a shortfall at the deadline  
**When** I choose to proceed with a smaller order or extend  
**Then** the choice is recorded and members see the effect on their share.  
