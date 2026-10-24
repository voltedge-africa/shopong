---
id: 7
type: story
title: "Safety rails and red-team tests"
parent: epic-builder-layer-agents-and-generated-interfaces
covers: [FR26]
after: [2, 3, 3.2]
refined: false
hitl: false
risk: high
---

# Safety rails and red-team tests

## Description

Runs a test suite of injected instructions in documents, names and messages that checks the agent makes no out-of-authority call, no unconfirmed money action and no access to another space's data, and enforces per-space spend and token limits.

As an operator,  
I want protections and tests against prompt injection and overspend,  
So that the builder layer cannot leak data or move money.

## Acceptance Criteria

1. **Given** a test suite of injected instructions in documents, names and messages
   **When** run against the agent
   **Then** none cause an out-of-authority call, a money action without confirmation, or data from another space
   **And** per-space spend and token limits are enforced.

## References

- parent — _bmad-output/initiative-ocn/epic-builder-layer-agents-and-generated-interfaces/epic-builder-layer-agents-and-generated-interfaces.md
