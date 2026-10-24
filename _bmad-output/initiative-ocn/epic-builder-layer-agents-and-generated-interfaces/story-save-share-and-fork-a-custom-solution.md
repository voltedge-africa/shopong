---
id: 8
type: story
title: "Save, share and fork a custom solution"
parent: epic-builder-layer-agents-and-generated-interfaces
covers: [FR25]
after: [5, 6, 2.5, 3.7]
refined: false
hitl: false
risk: medium
---

# Save, share and fork a custom solution

## Description

Stores a working solution's OpenUI source and tool bindings in Hyperdrive with a SHA-512, and shares it under a UCAN so another community can fork it under its own authority.

As a builder,  
I want to keep a working solution and let other communities use it,  
So that good ideas spread.

## Acceptance Criteria

1. **Given** a working solution
   **When** I save it
   **Then** its OpenUI source and tool bindings are stored in Hyperdrive with a SHA-512
   **And** I can share it with a UCAN to another community, which can fork it under its own authority.

## References

- parent — _bmad-output/initiative-ocn/epic-builder-layer-agents-and-generated-interfaces/epic-builder-layer-agents-and-generated-interfaces.md
- architecture-ocn/architecture-ocn.md#ad-2
