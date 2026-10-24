---
title: "Pay my contribution by bank payment"
ticket: 3
status: draft
---

## Story and acceptance criteria

As a member,
I want to pay my share from my own banking app,
So that I do not need cash or a new account.

**Acceptance Criteria:**

**Given** I pledged an amount  
**When** I tap "Pay"  
**Then** the Node creates a Stitch payment request with `externalReference` = event id and the app opens the returned URL in an in-app browser tab  
**And** card is disabled and the redirect domain is allow-listed HTTPS.  

**Given** I complete the payment  
**When** I return to the app  
**Then** it shows "waiting for confirmation" and does not mark the payment paid from redirect parameters alone.  
