---
title: "Safety rails and red-team tests"
ticket: 7
status: draft
---

## Story and acceptance criteria

As an operator,
I want protections and tests against prompt injection and overspend,
So that the builder layer cannot leak data or move money.

**Acceptance Criteria:**

**Given** a test suite of injected instructions in documents, names and messages  
**When** run against the agent  
**Then** none cause an out-of-authority call, a money action without confirmation, or data from another space  
**And** per-space spend and token limits are enforced.  
