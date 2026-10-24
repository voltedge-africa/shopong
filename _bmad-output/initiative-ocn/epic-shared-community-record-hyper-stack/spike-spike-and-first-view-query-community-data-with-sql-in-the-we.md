---
id: 8
type: spike
title: "Spike and first view: query community data with SQL in the web console"
parent: epic-shared-community-record-hyper-stack
covers: [AR2, AR3, AR7]
after: [2]
refined: false
hitl: false
risk: high
---

# Spike and first view: query community data with SQL in the web console

## Description

Shows that the web console can export the Hyperbee view to Arrow, run DuckDB-WASM SQL and render the result in a table, so organisers can ask questions such as who has not paid without a server, and records the persistence and GeoJSON decisions.

As a community organiser,  
I want to explore our data with SQL and charts in the browser,  
So that I can answer questions like "who has not paid" without a server.

## Acceptance Criteria

1. **Given** a pinned `@duckdb/duckdb-wasm` version
   **When** the console exports the Hyperbee view to Arrow and runs `LOAD spatial` and a query
   **Then** results render in a table
   **And** a decision record states OPFS persistence, GeoJSON handling and the pinned version.

## References

- parent — _bmad-output/initiative-ocn/epic-shared-community-record-hyper-stack/epic-shared-community-record-hyper-stack.md
- architecture-ocn/architecture-ocn.md#ad-5
