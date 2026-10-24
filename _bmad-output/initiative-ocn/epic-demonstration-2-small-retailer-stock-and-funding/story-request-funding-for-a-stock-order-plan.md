---
title: "Request funding for a stock order"
ticket: 3
status: draft
---

## Story and acceptance criteria

As a retailer,
I want to ask funders to help pay for stock,
So that I can buy more than my cash allows.

**Acceptance Criteria:**

**Given** a stock order  
**When** I request funding  
**Then** a `funding.requested` event is visible to holders of `funding/offer`  
**And** I can attach my verifiable record (story 10.5) if I choose.  
