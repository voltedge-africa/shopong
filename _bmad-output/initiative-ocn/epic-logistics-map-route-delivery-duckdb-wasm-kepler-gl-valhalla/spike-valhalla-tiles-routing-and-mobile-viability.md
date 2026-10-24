---
id: 1
type: spike
title: "Valhalla tiles, routing and mobile viability"
parent: epic-logistics-map-route-delivery-duckdb-wasm-kepler-gl-valhalla
covers: [AR7]
after: []
refined: false
hitl: false
risk: high
---

# Valhalla tiles, routing and mobile viability

## Description

Builds tiles from an OSM extract and tests Valhalla routing, isochrones, matrix and optimised routes in the browser and Node, and whether the engine runs on iOS and Android, ending in a recorded decision.

As a builder,  
I want to prove routing against our own tiles and learn what Valhalla-WASM cannot do,  
So that logistics design matches reality.

## Acceptance Criteria

1. **Given** an OSM extract for the pilot region
   **When** I build tiles with `pnpm run data:osm` and route with `createRouter` using `auto` and `truck`
   **Then** I record tile size, build time, route latency and memory in browser and Node.
2. **Given** Valhalla's documented surface
   **When** I test isochrone, matrix and optimised route
   **Then** I record whether each works
   **And** whether the engine runs on iOS and Android, with the decision recorded.

## References

- parent — _bmad-output/initiative-ocn/epic-logistics-map-route-delivery-duckdb-wasm-kepler-gl-valhalla/epic-logistics-map-route-delivery-duckdb-wasm-kepler-gl-valhalla.md
