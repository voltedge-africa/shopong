---
id: 2
type: story
title: "Create a community space with a deterministic view"
parent: epic-shared-community-record-hyper-stack
covers: [FR2, FR4, AR4, NFR4]
after: [1, 1.2, 1.3, 2.2]
refined: false
hitl: false
risk: high
---

# Create a community space with a deterministic view

## Description

Creates each community's own Autobase with a Hyperbee view and a versioned apply function, so one recorded event stream always yields the same view, and apply uses no wall clock, network or randomness.

As a treasurer,  
I want my community to have its own shared record,  
So that everything we do is in one place everyone can verify.

## Acceptance Criteria

1. **Given** a new community
   **When** it is created
   **Then** an Autobase is created with the creator as writer and indexer, a Hyperbee view with the defined key spaces, and a versioned `apply`.
2. **Given** a recorded event stream
   **When** replayed on two devices in different orders of arrival
   **Then** both produce byte-identical views (property test)
   **And** `apply` uses no wall clock, network or randomness.

## References

- parent — _bmad-output/initiative-ocn/epic-shared-community-record-hyper-stack/epic-shared-community-record-hyper-stack.md
