---
id: 4
type: story
title: "Plan a route to the collection point"
parent: epic-logistics-map-route-delivery-duckdb-wasm-kepler-gl-valhalla
covers: [FR15, AR4, AR7]
after: [1, 2, 3.2]
refined: false
hitl: false
risk: medium
---

# Plan a route to the collection point

## Description

A driver requests a truck route from a supplier depot to a collection point, sees its distance, time and line on a map, and the polyline and manifest release id are stored in a delivery.planned event.

As a driver,  
I want a route and an estimated time to the collection point,  
So that I can plan the delivery.

## Acceptance Criteria

1. **Given** a supplier depot and a collection point
   **When** I request a plan
   **Then** Valhalla returns a `truck` route and the app shows distance, time and the line on a map
   **And** the polyline6 and manifest release id are stored in the `delivery.planned` event.

## References

- parent — _bmad-output/initiative-ocn/epic-logistics-map-route-delivery-duckdb-wasm-kepler-gl-valhalla/epic-logistics-map-route-delivery-duckdb-wasm-kepler-gl-valhalla.md
