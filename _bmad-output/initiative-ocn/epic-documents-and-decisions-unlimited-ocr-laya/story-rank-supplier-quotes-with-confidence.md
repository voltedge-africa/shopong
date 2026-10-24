---
id: 5
type: story
title: "Rank supplier quotes with confidence"
parent: epic-documents-and-decisions-unlimited-ocr-laya
covers: [FR8]
after: [3, 4]
refined: false
hitl: false
risk: medium
---

# Rank supplier quotes with confidence

## Description

Ranks three to eight supplier quotes through laya-serve with a stated confidence and criteria, saying no clear recommendation below the threshold, and logs a treasurer's override as a labelled example.

As a treasurer,  
I want ranked supplier options with a stated confidence and the criteria used,  
So that I can decide faster without being told what to do.

## Acceptance Criteria

1. **Given** three to eight quotes
   **When** I ask for a ranking
   **Then** Laya answers a `choice` question through `laya-serve` with auth enabled and the UI shows the rank, the confidence and the criteria
   **And** below the confidence threshold it says "no clear recommendation".
2. **Given** I override the suggestion
   **When** I choose another supplier
   **Then** the override is logged as a labelled example.

## References

- parent — _bmad-output/initiative-ocn/epic-documents-and-decisions-unlimited-ocr-laya/epic-documents-and-decisions-unlimited-ocr-laya.md
- architecture-ocn/architecture-ocn.md#system-1-decision-model-via-laya
