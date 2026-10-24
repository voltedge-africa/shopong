---
title: "Spike and first view: query community data with SQL in the web console"
ticket: 8
status: in-progress
---

## Story and acceptance criteria

As a community organiser,
I want to explore our data with SQL and charts in the browser,
So that I can answer questions like "who has not paid" without a server.

**Acceptance Criteria:**

**Given** a pinned `@duckdb/duckdb-wasm` version  
**When** the console exports the Hyperbee view to Arrow and runs `LOAD spatial` and a query  
**Then** results render in a table  
**And** a decision record states OPFS persistence, GeoJSON handling and the pinned version.  
