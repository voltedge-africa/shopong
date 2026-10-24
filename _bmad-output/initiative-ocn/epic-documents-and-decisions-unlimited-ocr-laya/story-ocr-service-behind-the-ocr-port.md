---
id: 2
type: story
title: "OCR service behind the Ocr port"
parent: epic-documents-and-decisions-unlimited-ocr-laya
covers: [FR7, AR1, NFR7]
after: [1, 3.7]
refined: false
hitl: false
risk: medium
---

# OCR service behind the Ocr port

## Description

Uploaded price lists in Hyperdrive are queued by the Node, rasterised at 300 DPI and sent to the OCR endpoint, with the raw output stored beside the source and failures retried with backoff and shown in the operator view.

As a supplier or member,  
I want to upload a price list and have it read automatically,  
So that nobody retypes it.

## Acceptance Criteria

1. **Given** an upload in Hyperdrive
   **When** the Node queues it
   **Then** pages are rasterised at 300 DPI, sent to the OCR endpoint, and the raw output with `<|det|>` boxes is stored beside the source
   **And** failures retry with backoff and surface in the operator view.

## References

- parent — _bmad-output/initiative-ocn/epic-documents-and-decisions-unlimited-ocr-laya/epic-documents-and-decisions-unlimited-ocr-laya.md
- architecture-ocn/architecture-ocn.md#ocr-via-unlimited-ocr
