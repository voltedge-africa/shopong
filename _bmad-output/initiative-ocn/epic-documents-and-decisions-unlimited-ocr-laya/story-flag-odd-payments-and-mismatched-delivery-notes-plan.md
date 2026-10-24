---
title: "Flag odd payments and mismatched delivery notes"
ticket: 6
status: draft
---

## Story and acceptance criteria

As a treasurer,
I want unusual payments and mismatched delivery notes flagged,
So that problems surface early.

**Acceptance Criteria:**

**Given** a payment request or a delivery note with its order  
**When** the `noul` question is asked (as a two-option `choice` where needed)  
**Then** a flag with confidence is attached when above threshold  
**And** nothing is blocked automatically, only surfaced to the approvers.  
