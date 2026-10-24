---
title: "Follow a delivery and handle exceptions"
ticket: 7
status: draft
---

## Story and acceptance criteria

As a member,
I want to see where my delivery is and what went wrong if it is late,
So that I can plan and complain with evidence.

**Acceptance Criteria:**

**Given** a delivery in progress  
**When** I open it  
**Then** I see status (planned, started, arrived, collected) and the last confirmed point  
**And** a late, failed or partial delivery creates an exception event visible to all approvers.  
