---
title: "Map of members, collection points and demand"
ticket: 3
status: draft
---

## Story and acceptance criteria

As a treasurer,
I want to see demand and candidate collection points on a map,
So that I can choose a sensible place to collect.

**Acceptance Criteria:**

**Given** members' locations coarsened to a grid or suburb before leaving their device  
**When** the console loads them into DuckDB-WASM and Kepler.gl via `addDataToMap`  
**Then** I see demand clusters and candidate collection points  
**And** no exact home address is ever in the shared record.  
