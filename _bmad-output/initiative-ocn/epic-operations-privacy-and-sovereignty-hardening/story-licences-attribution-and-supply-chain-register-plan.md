---
title: "Licences, attribution and supply-chain register"
ticket: 7
status: draft
---

## Story and acceptance criteria

As the product owner,
I want every dependency and data source's licence tracked and shipped,
So that we comply and can answer questions.

**Acceptance Criteria:**

**Given** the dependency set  
**When** the register is generated  
**Then** it lists Apache-2.0 and MIT components, OSM ODbL attribution and Valhalla's compiled-dependency notices  
**And** CI fails when an unregistered licence appears.  
