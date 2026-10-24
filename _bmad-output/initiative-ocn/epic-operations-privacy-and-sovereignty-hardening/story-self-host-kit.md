---
id: 1
type: story
title: "Self-host kit"
parent: epic-operations-privacy-and-sovereignty-hardening
covers: [FR27, NFR5]
after: [1.5, 3.5, 6.2, 6.5, 7.2]
refined: false
hitl: false
risk: medium
---

# Self-host kit

## Description

Packages one compose file and an operator guide so a community can run the Node, the tile host, laya-serve and optional GPU services on its own infrastructure, with secrets supplied out of band.

As an operator,  
I want to run the OCN Node and its services from one compose file with a guide,  
So that a community can host its own infrastructure.

## Acceptance Criteria

1. **Given** the kit
   **When** I follow the operator guide on a clean machine
   **Then** the Node, tile host, `laya-serve` and optional GPU services start and pass a smoke test
   **And** secrets are provided out of band, not in the repo.

## References

- parent — _bmad-output/initiative-ocn/epic-operations-privacy-and-sovereignty-hardening/epic-operations-privacy-and-sovereignty-hardening.md
- architecture-ocn/architecture-ocn.md#ad-3
