---
id: 1
type: spike
title: "Unlimited-OCR on real documents and GPU sizing"
parent: epic-documents-and-decisions-unlimited-ocr-laya
covers: [FR7, AR3]
after: []
refined: false
hitl: true
risk: high
---

# Unlimited-OCR on real documents and GPU sizing

## Description

Measures Unlimited-OCR accuracy and cost on at least 30 real South African supplier documents, covering VRAM, pages per minute and output format, ending in decision D-4 on where GPU compute runs.

As a builder,  
I want to measure accuracy and cost of Unlimited-OCR on real South African supplier documents,  
So that we decide the GPU host and the review workflow.

## Acceptance Criteria

1. **Given** at least 30 real price lists, invoices and delivery notes
   **When** parsed through `vllm/vllm-openai:unlimited-ocr`
   **Then** I record field accuracy, pages per minute, VRAM and cost per page
   **And** whether output is Markdown or block-structured with boxes.
2. **Given** the results
   **When** reviewed
   **Then** decision D-4 (where GPU compute runs) is recorded.

## References

- parent — _bmad-output/initiative-ocn/epic-documents-and-decisions-unlimited-ocr-laya/epic-documents-and-decisions-unlimited-ocr-laya.md
- architecture-ocn/architecture-ocn.md#ocr-via-unlimited-ocr
- architecture-ocn/architecture-ocn.md#9-decisions
