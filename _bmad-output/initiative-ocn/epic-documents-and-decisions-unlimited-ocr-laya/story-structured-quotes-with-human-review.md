---
id: 3
type: story
title: "Structured quotes with human review"
parent: epic-documents-and-decisions-unlimited-ocr-laya
covers: [FR5, FR7]
after: [2, 3.7]
refined: false
hitl: false
risk: medium
---

# Structured quotes with human review

## Description

Shows each extracted price-list row beside its source region so a treasurer can accept, edit or reject it before it counts, and accepted rows become quote.added events carrying the source hash.

As a treasurer,  
I want extracted price-list rows checked against the page image before they count,  
So that mistakes in OCR do not become wrong orders.

## Acceptance Criteria

1. **Given** extracted rows (`item`, `unit`, `pack size`, `price`)
   **When** I open review
   **Then** each row is shown beside its source region and I can accept, edit or reject it
   **And** accepted rows become `quote.added` events with the source hash.

## References

- parent — _bmad-output/initiative-ocn/epic-documents-and-decisions-unlimited-ocr-laya/epic-documents-and-decisions-unlimited-ocr-laya.md
- architecture-ocn/architecture-ocn.md#ocr-via-unlimited-ocr
