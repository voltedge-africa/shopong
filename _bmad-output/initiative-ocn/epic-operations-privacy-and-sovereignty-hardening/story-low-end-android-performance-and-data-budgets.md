---
id: 5
type: story
title: "Low-end Android performance and data budgets"
parent: epic-operations-privacy-and-sovereignty-hardening
covers: [NFR2, NFR9, UX-DR3]
after: [8.7, 9.6]
refined: false
hitl: false
risk: medium
---

# Low-end Android performance and data budgets

## Description

Measures start-up time, memory, battery and data per flow on the device baseline from decision D-6, and adds a low-data mode that defers photos and large files.

As a member on an inexpensive phone,  
I want the app to be fast and light on data,  
So that I can actually use it.

## Acceptance Criteria

1. **Given** the device baseline from decision D-6
   **When** I run the performance suite
   **Then** start-up time, memory, battery and data per flow meet the stated budgets
   **And** a low-data mode defers photos and large files.

## References

- parent — _bmad-output/initiative-ocn/epic-operations-privacy-and-sovereignty-hardening/epic-operations-privacy-and-sovereignty-hardening.md
