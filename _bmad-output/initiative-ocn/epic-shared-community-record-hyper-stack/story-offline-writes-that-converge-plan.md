---
title: "Offline writes that converge"
ticket: 4
status: draft
---

## Story and acceptance criteria

As a member in a low-signal area,
I want to record actions offline and have them sync later,
So that bad connectivity does not stop the group.

**Acceptance Criteria:**

**Given** two devices that diverge offline for an hour with different writes  
**When** they reconnect over Hyperswarm  
**Then** both converge to the same view with no lost events  
**And** the UI marks events as "on your phone" until the group has seen them.  
