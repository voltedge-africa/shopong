---
title: "Spike: Stitch disbursements, auth and webhook verification"
ticket: 4
status: draft
---

## Story and acceptance criteria

As a builder,
I want to confirm Stitch's payout API, client-credentials flow, webhook signature method and settlement times,
So that we can design pay-out and reconciliation correctly.

**Acceptance Criteria:**

**Given** the Stitch IDE, Postman collection and docs  
**When** I run the client-credentials flow and a test disbursement  
**Then** I record the endpoints, scopes, limits, signature verification method and settlement times.  

**Given** the findings  
**When** compared with architecture assumptions  
**Then** a decision record lists any change to stories 4.5-4.7.  
