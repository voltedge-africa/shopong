---
id: 9
type: story
title: "Model routing and local fallback"
parent: epic-builder-layer-agents-and-generated-interfaces
covers: [NFR3]
after: [1]
refined: false
hitl: false
risk: medium
---

# Model routing and local fallback

## Description

Lets operators choose models per task with a local fallback and cost caps, so the Node falls back to a local model when a hosted provider fails or a cap is hit, with prompts that carry no raw personal data and payloads that are not logged.

As an operator,  
I want to choose models per task with a local fallback and cost caps,  
So that we stay affordable and sovereign.

## Acceptance Criteria

1. **Given** configured providers and a local OpenAI-compatible endpoint
   **When** a hosted provider fails or the cap is hit
   **Then** the Node falls back to the local model or refuses with a clear message
   **And** prompts carry no raw personal data and payloads are not logged.

## References

- parent — _bmad-output/initiative-ocn/epic-builder-layer-agents-and-generated-interfaces/epic-builder-layer-agents-and-generated-interfaces.md
