---
id: 5
type: story
title: "Multi-stop delivery runs"
parent: epic-logistics-map-route-delivery-duckdb-wasm-kepler-gl-valhalla
covers: [FR15]
after: [1, 4]
refined: false
hitl: false
risk: medium
---

# Multi-stop delivery runs

## Description

Orders two to eight collection points into one run using the approach decided in spike 7.1, shows the total time, and stores the run with its ordering method named.

As a driver,  
I want several collection points ordered into one run,  
So that one trip serves more than one group.

## Acceptance Criteria

1. **Given** two to eight stops
   **When** I ask for a run
   **Then** the stops are ordered by the approach chosen in spike 7.1 (engine support or our own heuristic) and total time is shown
   **And** the run is stored with its method named.

## References

- parent — _bmad-output/initiative-ocn/epic-logistics-map-route-delivery-duckdb-wasm-kepler-gl-valhalla/epic-logistics-map-route-delivery-duckdb-wasm-kepler-gl-valhalla.md
