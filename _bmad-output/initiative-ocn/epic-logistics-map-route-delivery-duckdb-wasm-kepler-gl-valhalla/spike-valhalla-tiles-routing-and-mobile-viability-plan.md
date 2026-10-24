---
title: "Spike: Valhalla tiles, routing and mobile viability"
ticket: 1
status: in-progress
---

## Story and acceptance criteria

As a builder,
I want to prove routing against our own tiles and learn what Valhalla-WASM cannot do,
So that logistics design matches reality.

**Acceptance Criteria:**

**Given** an OSM extract for the pilot region  
**When** I build tiles with `pnpm run data:osm` and route with `createRouter` using `auto` and `truck`  
**Then** I record tile size, build time, route latency and memory in browser and Node.  

**Given** Valhalla's documented surface  
**When** I test isochrone, matrix and optimised route  
**Then** I record whether each works  
**And** whether the engine runs on iOS and Android, with the decision recorded.  
