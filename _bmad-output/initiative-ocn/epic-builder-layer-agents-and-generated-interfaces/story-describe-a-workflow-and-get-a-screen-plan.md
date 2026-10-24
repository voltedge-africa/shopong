---
title: "Describe a workflow and get a screen"
ticket: 5
status: draft
---

## Story and acceptance criteria

As a member,
I want to describe what I need and see a working screen,
So that I do not wait for a developer.

**Acceptance Criteria:**

**Given** the prompt "show who still owes this month and let me remind them"  
**When** the agent composes the answer  
**Then** OpenUI Lang streams to the `Renderer` and the screen appears progressively with real data  
**And** an invalid or out-of-library component is dropped with a visible notice.  
