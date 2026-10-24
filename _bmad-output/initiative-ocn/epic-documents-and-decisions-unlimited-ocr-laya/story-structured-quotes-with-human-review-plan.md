---
title: "Structured quotes with human review"
ticket: 3
status: draft
---

## Story and acceptance criteria

As a treasurer,
I want extracted price-list rows checked against the page image before they count,
So that mistakes in OCR do not become wrong orders.

**Acceptance Criteria:**

**Given** extracted rows (`item`, `unit`, `pack size`, `price`)  
**When** I open review  
**Then** each row is shown beside its source region and I can accept, edit or reject it  
**And** accepted rows become `quote.added` events with the source hash.  
