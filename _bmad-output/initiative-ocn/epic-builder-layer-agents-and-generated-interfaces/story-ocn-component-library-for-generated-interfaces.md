---
id: 4
type: story
title: "OCN component library for generated interfaces"
parent: epic-builder-layer-agents-and-generated-interfaces
covers: [FR24, UX-DR4]
after: [2]
refined: false
hitl: false
risk: medium
---

# OCN component library for generated interfaces

## Description

Provides an approved component library (Stack, Metric, Table, Form and others) that the model may use, with each component declaring which capability it may bind to, and generates the spec and system prompt locally with no hosted service.

As a builder,  
I want an approved set of components the model may use,  
So that generated screens look native and cannot do arbitrary things.

## Acceptance Criteria

1. **Given** `createLibrary` with Stack, Metric, Table, Form, Timeline, Map, Chart, ActionButton, MemberList, QuoteCompare and PledgeProgress
   **When** I run `generate --spec` and `generateSystemPrompt` locally
   **Then** the spec and prompt are produced without any hosted service
   **And** each component declares which capability read or action it may bind to.

## References

- parent — _bmad-output/initiative-ocn/epic-builder-layer-agents-and-generated-interfaces/epic-builder-layer-agents-and-generated-interfaces.md
- architecture-ocn/architecture-ocn.md#ad-11
