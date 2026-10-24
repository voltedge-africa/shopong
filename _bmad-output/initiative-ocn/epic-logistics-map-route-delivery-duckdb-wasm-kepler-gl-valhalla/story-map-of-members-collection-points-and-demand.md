---
id: 3
type: story
title: "Map of members, collection points and demand"
parent: epic-logistics-map-route-delivery-duckdb-wasm-kepler-gl-valhalla
covers: [FR14, AR7, NFR3]
after: [3.8]
refined: false
hitl: false
risk: medium
---

# Map of members, collection points and demand

## Description

Shows demand clusters and candidate collection points on the console map from member locations coarsened on the device, so no exact home address enters the shared record.

As a treasurer,  
I want to see demand and candidate collection points on a map,  
So that I can choose a sensible place to collect.

## Acceptance Criteria

1. **Given** members' locations coarsened to a grid or suburb before leaving their device
   **When** the console loads them into DuckDB-WASM and Kepler.gl via `addDataToMap`
   **Then** I see demand clusters and candidate collection points
   **And** no exact home address is ever in the shared record.

## References

- parent — _bmad-output/initiative-ocn/epic-logistics-map-route-delivery-duckdb-wasm-kepler-gl-valhalla/epic-logistics-map-route-delivery-duckdb-wasm-kepler-gl-valhalla.md
