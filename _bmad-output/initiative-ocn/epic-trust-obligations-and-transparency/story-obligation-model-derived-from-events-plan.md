---
title: "Obligation model derived from events"
ticket: 1
status: draft
---

## Story and acceptance criteria

As a participant,
I want clear obligations (who owes whom what by when),
So that nothing depends on memory.

**Acceptance Criteria:**

**Given** events such as `pledge.created`, `funding.accepted` and `delivery.confirmed`  
**When** the view is built  
**Then** obligations are derived deterministically with state (open, due, overdue, settled)  
**And** the same events always produce the same obligations.  
