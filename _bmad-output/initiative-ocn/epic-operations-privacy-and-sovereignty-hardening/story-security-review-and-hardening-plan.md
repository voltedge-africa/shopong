---
title: "Security review and hardening"
ticket: 6
status: draft
---

## Story and acceptance criteria

As the product owner,
I want an independent security review of key handling, webhooks, the sandbox and the web console,
So that real money is safe.

**Acceptance Criteria:**

**Given** the architecture and code  
**When** reviewed  
**Then** findings are triaged with owners  
**And** the CSP for WASM is scoped to the console origin only.  
