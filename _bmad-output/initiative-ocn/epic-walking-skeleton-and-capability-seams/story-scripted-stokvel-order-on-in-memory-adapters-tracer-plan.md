---
title: "Scripted stokvel order on in-memory adapters (tracer)"
ticket: 4
status: done
---

## Story and acceptance criteria

As a stokvel treasurer,
I want to see a whole bulk order run from proposal to collection in the app,
So that the product shape is real before any external system is connected.

**Acceptance Criteria:**

**Given** the in-memory adapters and a seeded stokvel of five members  
**When** I run the scripted scenario  
**Then** the app shows the order proposed, pledges received, supplier paid, delivery planned and collection confirmed in order  
**And** an automated end-to-end test asserts the same sequence.  
