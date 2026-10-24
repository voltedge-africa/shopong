---
id: 7
type: story
title: "Licences, attribution and supply-chain register"
parent: epic-operations-privacy-and-sovereignty-hardening
covers: [NFR8]
after: [1.1, 7.2]
refined: false
hitl: false
risk: low
---

# Licences, attribution and supply-chain register

## Description

Generates a register of every dependency's and data source's licence, including Apache-2.0 and MIT components, OSM ODbL attribution and Valhalla's compiled-dependency notices, and fails CI when an unregistered licence appears.

As the product owner,  
I want every dependency and data source's licence tracked and shipped,  
So that we comply and can answer questions.

## Acceptance Criteria

1. **Given** the dependency set
   **When** the register is generated
   **Then** it lists Apache-2.0 and MIT components, OSM ODbL attribution and Valhalla's compiled-dependency notices
   **And** CI fails when an unregistered licence appears.

## References

- parent — _bmad-output/initiative-ocn/epic-operations-privacy-and-sovereignty-hardening/epic-operations-privacy-and-sovereignty-hardening.md
