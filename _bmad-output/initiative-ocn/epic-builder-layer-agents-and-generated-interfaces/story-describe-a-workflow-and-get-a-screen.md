---
id: 5
type: story
title: "Describe a workflow and get a screen"
parent: epic-builder-layer-agents-and-generated-interfaces
covers: [FR23, FR24, UX-DR4]
after: [2, 3, 4, 8.4]
refined: false
hitl: false
risk: medium
---

# Describe a workflow and get a screen

## Description

Streams a working screen with real data from a member's plain-language description, dropping any invalid or out-of-library component with a visible notice.

As a member,  
I want to describe what I need and see a working screen,  
So that I do not wait for a developer.

## Acceptance Criteria

1. **Given** the prompt "show who still owes this month and let me remind them"
   **When** the agent composes the answer
   **Then** OpenUI Lang streams to the `Renderer` and the screen appears progressively with real data
   **And** an invalid or out-of-library component is dropped with a visible notice.

## References

- parent — _bmad-output/initiative-ocn/epic-builder-layer-agents-and-generated-interfaces/epic-builder-layer-agents-and-generated-interfaces.md
- architecture-ocn/architecture-ocn.md#ad-11
