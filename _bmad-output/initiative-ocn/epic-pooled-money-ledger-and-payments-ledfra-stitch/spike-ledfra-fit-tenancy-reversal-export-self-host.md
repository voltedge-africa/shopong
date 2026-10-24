---
id: 1
type: spike
title: "Ledfra fit (tenancy, reversal, export, self-host)"
parent: epic-pooled-money-ledger-and-payments-ledfra-stitch
covers: [FR10, FR12, AR3]
after: [1.6]
refined: false
hitl: true
risk: high
---

# Ledfra fit (tenancy, reversal, export, self-host)

## Description

Tests the Ledfra sandbox for per-community ledgers, guarded accounts, idempotency conflicts, reversals and reports, and collects the vendor's written answers on self-hosting, export, licence and residency, ending in decision D-2.

As a builder,  
I want answers to Ledfra's open questions in writing from the vendor and from the sandbox,  
So that we decide on a hosted ledger with eyes open.

## Acceptance Criteria

1. **Given** a sandbox workspace
   **When** I test per-community ledgers, guarded accounts, idempotency conflicts, reversals and reports
   **Then** I record behaviour for each and the vendor's written answers on self-hosting, export, licence, rate limits and data residency.
2. **Given** the findings
   **When** reviewed with the product owner
   **Then** decision D-2 is recorded (accept hosted with the mirror strategy, or require another ledger) with the 2026-12-31 Early Access deadline considered.

## References

- parent — _bmad-output/initiative-ocn/epic-pooled-money-ledger-and-payments-ledfra-stitch/epic-pooled-money-ledger-and-payments-ledfra-stitch.md
- architecture-ocn/architecture-ocn.md#de-ledger-via-ledfra
- architecture-ocn/architecture-ocn.md#9-decisions
