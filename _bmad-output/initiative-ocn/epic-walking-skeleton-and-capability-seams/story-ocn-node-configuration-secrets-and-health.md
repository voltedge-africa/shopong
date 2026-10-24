---
id: 5
type: story
title: "OCN Node configuration, secrets and health"
parent: epic-walking-skeleton-and-capability-seams
covers: [NFR5, NFR7]
after: [1, 2]
refined: false
hitl: false
risk: medium
---

# OCN Node configuration, secrets and health

## Description

The OCN Node loads configuration and secrets safely and exposes health and metrics, so credentials never reach devices and operators can see the Node working.

As an operator,  
I want the OCN Node to load configuration and secrets safely and expose health and metrics,  
So that credentials never reach devices and I can see the Node is working.

## Acceptance Criteria

1. **Given** a Node started with a config file and secret environment variables
   **When** a required secret is missing
   **Then** it refuses to start and names the missing key without printing any secret values.
2. **Given** a running Node
   **When** I request `/health`
   **Then** it returns component status for the record, ledger, payments and queue.

## References

- parent — _bmad-output/initiative-ocn/epic-walking-skeleton-and-capability-seams/epic-walking-skeleton-and-capability-seams.md
- architecture-ocn/architecture-ocn.md#ad-3
