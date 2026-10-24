---
title: "Tile build pipeline and hosting"
ticket: 2
status: draft
---

## Story and acceptance criteria

As an operator,
I want a reproducible tile build and static hosting with a versioned manifest,
So that routes are consistent and attribution is complete.

**Acceptance Criteria:**

**Given** a pinned OSM extract  
**When** the pipeline runs  
**Then** it outputs tiles, `graph.tar` and a manifest with a release id into static storage  
**And** the app and Node shows OSM (ODbL) attribution.  
