---
title: "Hold part of the pool as stablecoin, mirrored in the books"
ticket: 3
status: draft
---

## Story and acceptance criteria

As a treasurer,
I want some pooled funds held as stablecoin and shown alongside the rest,
So that members see all funds in one place.

**Acceptance Criteria:**

**Given** a conversion approved by the required approvers  
**When** it executes  
**Then** the transaction signature is stored in the event and a balanced ledger entry moves value between `assets:bank/pool` and `assets:wallet/stable`  
**And** the pool view shows both with the on-chain proof link.  
