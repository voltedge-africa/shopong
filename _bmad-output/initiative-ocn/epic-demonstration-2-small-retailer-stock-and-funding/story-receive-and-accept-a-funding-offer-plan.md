---
title: "Receive and accept a funding offer"
ticket: 4
status: draft
---

## Story and acceptance criteria

As a retailer,
I want to compare and accept funding offers,
So that terms are clear before I commit.

**Acceptance Criteria:**

**Given** one or more offers  
**When** I accept one  
**Then** a `funding.accepted` event creates an obligation (amount, due date, repayment schedule) and ledger receivable and payable accounts for both parties.  
