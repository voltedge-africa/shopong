---
title: "Deterministic capability checks in `apply` using log time"
ticket: 6
status: draft
---

## Story and acceptance criteria

As a builder,
I want expiry and revocation evaluated from the log itself,
So that every peer reaches the same view.

**Acceptance Criteria:**

**Given** a UCAN with an expiry  
**When** `apply` evaluates it  
**Then** it compares against log time (the highest accepted `claimedAt`), not `Date.now()`  
**And** replays on a later date produce the same result.  

**Given** a `role.revoked` event  
**When** a later event uses the revoked capability  
**Then** `apply` rejects the later event and records it as refused.  
