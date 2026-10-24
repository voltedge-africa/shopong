---
title: "OCR service behind the Ocr port"
ticket: 2
status: draft
---

## Story and acceptance criteria

As a supplier or member,
I want to upload a price list and have it read automatically,
So that nobody retypes it.

**Acceptance Criteria:**

**Given** an upload in Hyperdrive  
**When** the Node queues it  
**Then** pages are rasterised at 300 DPI, sent to the OCR endpoint, and the raw output with `<|det|>` boxes is stored beside the source  
**And** failures retry with backoff and surface in the operator view.  
