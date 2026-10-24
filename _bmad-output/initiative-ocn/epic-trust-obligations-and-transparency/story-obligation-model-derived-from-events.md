---
id: 1
type: story
title: "Obligation model derived from events"
parent: epic-trust-obligations-and-transparency
covers: [FR20]
after: [3.2]
refined: false
hitl: false
risk: medium
---

# Obligation model derived from events

## Description

Derives who owes whom what, and by when, from events such as pledge.created, funding.accepted and delivery.confirmed, with state open, due, overdue or settled, so the same events always give the same obligations.

As a participant,  
I want clear obligations (who owes whom what by when),  
So that nothing depends on memory.

## Acceptance Criteria

1. **Given** events such as `pledge.created`, `funding.accepted` and `delivery.confirmed`
   **When** the view is built
   **Then** obligations are derived deterministically with state (open, due, overdue, settled)
   **And** the same events always produce the same obligations.

## References

- parent — _bmad-output/initiative-ocn/epic-trust-obligations-and-transparency/epic-trust-obligations-and-transparency.md
