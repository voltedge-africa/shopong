---
title: "Spike: Unlimited-OCR on real documents and GPU sizing"
ticket: 1
status: draft
---

## Story and acceptance criteria

As a builder,
I want to measure accuracy and cost of Unlimited-OCR on real South African supplier documents,
So that we decide the GPU host and the review workflow.

**Acceptance Criteria:**

**Given** at least 30 real price lists, invoices and delivery notes  
**When** parsed through `vllm/vllm-openai:unlimited-ocr`  
**Then** I record field accuracy, pages per minute, VRAM and cost per page  
**And** whether output is Markdown or block-structured with boxes.  

**Given** the results  
**When** reviewed  
**Then** decision D-4 (where GPU compute runs) is recorded.  
