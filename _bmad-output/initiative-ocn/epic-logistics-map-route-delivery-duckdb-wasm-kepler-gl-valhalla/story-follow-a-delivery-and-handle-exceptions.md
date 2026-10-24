---
id: 7
type: story
title: "Follow a delivery and handle exceptions"
parent: epic-logistics-map-route-delivery-duckdb-wasm-kepler-gl-valhalla
covers: [FR17]
after: [4, 6]
refined: false
hitl: false
risk: medium
---

# Follow a delivery and handle exceptions

## Description

Members see a delivery's status (planned, started, arrived, collected) and its last confirmed point, and a late, failed or partial delivery creates an exception event visible to all approvers.

As a member,  
I want to see where my delivery is and what went wrong if it is late,  
So that I can plan and complain with evidence.

## Acceptance Criteria

1. **Given** a delivery in progress
   **When** I open it
   **Then** I see status (planned, started, arrived, collected) and the last confirmed point
   **And** a late, failed or partial delivery creates an exception event visible to all approvers.

## References

- parent — _bmad-output/initiative-ocn/epic-logistics-map-route-delivery-duckdb-wasm-kepler-gl-valhalla/epic-logistics-map-route-delivery-duckdb-wasm-kepler-gl-valhalla.md
