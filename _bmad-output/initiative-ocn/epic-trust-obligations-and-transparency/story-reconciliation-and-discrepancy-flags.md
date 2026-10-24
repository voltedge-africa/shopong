---
id: 3
type: story
title: "Reconciliation and discrepancy flags"
parent: epic-trust-obligations-and-transparency
covers: [FR21, AR5]
after: [3.2, 4.2, 4.5]
refined: false
hitl: false
risk: high
---

# Reconciliation and discrepancy flags

## Description

A scheduled reconciliation checks that the record, the ledger and the payment processor agree, and opens a discrepancy with both values and the event id when a total or status differs.

As a treasurer,  
I want automatic checks that the record, ledger and payment processor agree,  
So that problems are caught early.

## Acceptance Criteria

1. **Given** a scheduled reconciliation
   **When** a total or a status differs between systems
   **Then** a discrepancy is created with both values and the event id
   **And** it is visible to approvers until resolved with a recorded reason.

## References

- parent — _bmad-output/initiative-ocn/epic-trust-obligations-and-transparency/epic-trust-obligations-and-transparency.md
