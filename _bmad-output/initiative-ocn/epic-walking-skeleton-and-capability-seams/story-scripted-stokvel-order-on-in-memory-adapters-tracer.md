---
id: 4
type: story
title: "Scripted stokvel order on in-memory adapters (tracer)"
parent: epic-walking-skeleton-and-capability-seams
covers: [AR1]
after: [1, 2, 3]
refined: false
hitl: false
risk: medium
---

# Scripted stokvel order on in-memory adapters (tracer)

## Description

Runs a whole bulk stokvel order from proposal to collection in the app on in-memory adapters, so the product shape is real before any external system is connected.

As a stokvel treasurer,  
I want to see a whole bulk order run from proposal to collection in the app,  
So that the product shape is real before any external system is connected.

## Acceptance Criteria

1. **Given** the in-memory adapters and a seeded stokvel of five members
   **When** I run the scripted scenario
   **Then** the app shows the order proposed, pledges received, supplier paid, delivery planned and collection confirmed in order
   **And** an automated end-to-end test asserts the same sequence.

## References

- parent — _bmad-output/initiative-ocn/epic-walking-skeleton-and-capability-seams/epic-walking-skeleton-and-capability-seams.md
