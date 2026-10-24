---
title: "Plan a route to the collection point"
ticket: 4
status: draft
---

## Story and acceptance criteria

As a driver,
I want a route and an estimated time to the collection point,
So that I can plan the delivery.

**Acceptance Criteria:**

**Given** a supplier depot and a collection point  
**When** I request a plan  
**Then** Valhalla returns a `truck` route and the app shows distance, time and the line on a map  
**And** the polyline6 and manifest release id are stored in the `delivery.planned` event.  
