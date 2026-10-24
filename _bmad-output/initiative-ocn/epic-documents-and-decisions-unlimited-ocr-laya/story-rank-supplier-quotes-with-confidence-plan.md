---
title: "Rank supplier quotes with confidence"
ticket: 5
status: draft
---

## Story and acceptance criteria

As a treasurer,
I want ranked supplier options with a stated confidence and the criteria used,
So that I can decide faster without being told what to do.

**Acceptance Criteria:**

**Given** three to eight quotes  
**When** I ask for a ranking  
**Then** Laya answers a `choice` question through `laya-serve` with auth enabled and the UI shows the rank, the confidence and the criteria  
**And** below the confidence threshold it says "no clear recommendation".  

**Given** I override the suggestion  
**When** I choose another supplier  
**Then** the override is logged as a labelled example.  
