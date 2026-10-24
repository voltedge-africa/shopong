---
title: "Actions from generated screens with human confirmation"
ticket: 6
status: draft
---

## Story and acceptance criteria

As a member,
I want buttons in generated screens to act within my authority,
So that custom screens are useful and safe.

**Acceptance Criteria:**

**Given** a generated button bound to a capability  
**When** I press it  
**Then** `onAction` calls the capability API with my UCAN  
**And** any money action shows the confirmation step and cannot run without it.  
