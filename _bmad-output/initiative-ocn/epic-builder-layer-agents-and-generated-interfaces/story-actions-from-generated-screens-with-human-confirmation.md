---
id: 6
type: story
title: "Actions from generated screens with human confirmation"
parent: epic-builder-layer-agents-and-generated-interfaces
covers: [FR26]
after: [2, 4, 5, 2.5]
refined: false
hitl: true
risk: high
---

# Actions from generated screens with human confirmation

## Description

Makes buttons in generated screens call capability APIs with the member's UCAN, and makes any money action show a confirmation step that cannot be bypassed.

As a member,  
I want buttons in generated screens to act within my authority,  
So that custom screens are useful and safe.

## Acceptance Criteria

1. **Given** a generated button bound to a capability
   **When** I press it
   **Then** `onAction` calls the capability API with my UCAN
   **And** any money action shows the confirmation step and cannot run without it.

## References

- parent — _bmad-output/initiative-ocn/epic-builder-layer-agents-and-generated-interfaces/epic-builder-layer-agents-and-generated-interfaces.md
- architecture-ocn/architecture-ocn.md#ad-17
