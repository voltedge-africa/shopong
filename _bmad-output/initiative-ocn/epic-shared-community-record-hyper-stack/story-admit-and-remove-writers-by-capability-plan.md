---
title: "Admit and remove writers by capability"
ticket: 3
status: draft
---

## Story and acceptance criteria

As a treasurer,
I want new members' devices to become writers only with a valid invitation,
So that the record cannot be written by outsiders.

**Acceptance Criteria:**

**Given** a valid `member.joined` event with a UCAN chain  
**When** `apply` runs  
**Then** it calls `host.addWriter` for the member's writer key  
**And** removing a member calls `host.removeWriter` and refuses to remove the last indexer.  
