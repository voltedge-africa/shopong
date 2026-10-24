---
id: 6
type: story
title: "Flag odd payments and mismatched delivery notes"
parent: epic-documents-and-decisions-unlimited-ocr-laya
covers: [FR7]
after: [2, 4]
refined: false
hitl: false
risk: medium
---

# Flag odd payments and mismatched delivery notes

## Description

Attaches a flag with confidence to unusual payment requests and to delivery notes that do not match their order, and surfaces the flags to approvers without blocking anything automatically.

As a treasurer,  
I want unusual payments and mismatched delivery notes flagged,  
So that problems surface early.

## Acceptance Criteria

1. **Given** a payment request or a delivery note with its order
   **When** the `noul` question is asked (as a two-option `choice` where needed)
   **Then** a flag with confidence is attached when above threshold
   **And** nothing is blocked automatically, only surfaced to the approvers.

## References

- parent — _bmad-output/initiative-ocn/epic-documents-and-decisions-unlimited-ocr-laya/epic-documents-and-decisions-unlimited-ocr-laya.md
- architecture-ocn/architecture-ocn.md#system-1-decision-model-via-laya
