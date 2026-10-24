---
id: 6
type: story
title: "Proof of delivery and proof of collection"
parent: epic-logistics-map-route-delivery-duckdb-wasm-kepler-gl-valhalla
covers: [FR16, AR4]
after: [4, 3.7, 4.7]
refined: false
hitl: true
risk: high
---

# Proof of delivery and proof of collection

## Description

A driver with delivery/confirm records a signed arrival with time, coarse location and a SHA-512-referenced photo, and each member's collection is recorded as collection.confirmed, both showing progress on the order.

As a treasurer,  
I want delivery and collection confirmed with proof,  
So that the supplier is released and members know goods arrived.

## Acceptance Criteria

1. **Given** a driver with `delivery/confirm`
   **When** they confirm arrival
   **Then** a signed event with time, coarse location and a photo (SHA-512 in Hyperdrive) is recorded.
2. **Given** a member collects their share
   **When** they confirm
   **Then** a `collection.confirmed` event is recorded and the order shows progress.

## References

- parent — _bmad-output/initiative-ocn/epic-logistics-map-route-delivery-duckdb-wasm-kepler-gl-valhalla/epic-logistics-map-route-delivery-duckdb-wasm-kepler-gl-valhalla.md
