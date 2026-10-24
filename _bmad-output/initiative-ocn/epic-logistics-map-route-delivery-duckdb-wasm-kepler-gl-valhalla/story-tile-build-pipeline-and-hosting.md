---
id: 2
type: story
title: "Tile build pipeline and hosting"
parent: epic-logistics-map-route-delivery-duckdb-wasm-kepler-gl-valhalla
covers: [AR9, NFR8]
after: [1]
refined: false
hitl: false
risk: medium
---

# Tile build pipeline and hosting

## Description

A reproducible pipeline builds tiles, graph.tar and a versioned manifest from a pinned OSM extract into static storage, with OSM attribution shown in the app and Node.

As an operator,  
I want a reproducible tile build and static hosting with a versioned manifest,  
So that routes are consistent and attribution is complete.

## Acceptance Criteria

1. **Given** a pinned OSM extract
   **When** the pipeline runs
   **Then** it outputs tiles, `graph.tar` and a manifest with a release id into static storage
   **And** the app and Node shows OSM (ODbL) attribution.

## References

- parent — _bmad-output/initiative-ocn/epic-logistics-map-route-delivery-duckdb-wasm-kepler-gl-valhalla/epic-logistics-map-route-delivery-duckdb-wasm-kepler-gl-valhalla.md
