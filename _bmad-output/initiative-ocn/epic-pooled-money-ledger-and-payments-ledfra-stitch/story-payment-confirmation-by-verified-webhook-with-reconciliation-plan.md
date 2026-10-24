---
title: "Payment confirmation by verified webhook, with reconciliation"
ticket: 5
status: draft
---

## Story and acceptance criteria

As a treasurer,
I want payments confirmed only from verified Stitch webhooks, with a safety net,
So that nobody is credited for money that did not arrive.

**Acceptance Criteria:**

**Given** a `PaymentInitiationRequestCompleted` webhook  
**When** the Node verifies its signature and de-duplicates by payment id  
**Then** it posts to the ledger and appends a `payment.completed` event.  

**Given** no webhook arrives before a timeout  
**When** the reconciler polls `node(id)`  
**Then** it resolves the payment's state and records it  
**And** webhook replays and failures are visible to the operator.  
