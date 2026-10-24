---
title: "Self-host kit"
ticket: 1
status: draft
---

## Story and acceptance criteria

As an operator,
I want to run the OCN Node and its services from one compose file with a guide,
So that a community can host its own infrastructure.

**Acceptance Criteria:**

**Given** the kit  
**When** I follow the operator guide on a clean machine  
**Then** the Node, tile host, `laya-serve` and optional GPU services start and pass a smoke test  
**And** secrets are provided out of band, not in the repo.  
