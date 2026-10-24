---
id: 6
type: story
title: "Security review and hardening"
parent: epic-operations-privacy-and-sovereignty-hardening
covers: [AR8]
after: [1.2, 2.6, 3.8, 4.5, 5.2, 11.3]
refined: false
hitl: true
risk: high
---

# Security review and hardening

## Description

Has an independent review of key handling, webhooks, the sandbox and the web console, triages each finding to an owner, and scopes the WASM content security policy to the console origin only.

As the product owner,  
I want an independent security review of key handling, webhooks, the sandbox and the web console,  
So that real money is safe.

## Acceptance Criteria

1. **Given** the architecture and code
   **When** reviewed
   **Then** findings are triaged with owners
   **And** the CSP for WASM is scoped to the console origin only.

## References

- parent — _bmad-output/initiative-ocn/epic-operations-privacy-and-sovereignty-hardening/epic-operations-privacy-and-sovereignty-hardening.md
- architecture-ocn/architecture-ocn.md#7-security-privacy-and-sovereignty
