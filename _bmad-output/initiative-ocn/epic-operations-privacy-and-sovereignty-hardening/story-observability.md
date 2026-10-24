---
id: 4
type: story
title: "Observability"
parent: epic-operations-privacy-and-sovereignty-hardening
covers: [NFR7]
after: [3.5, 4.5, 10.3]
refined: false
hitl: false
risk: medium
---

# Observability

## Description

Adds dashboards and alerts for replication lag, webhook failures, stalled queues and reconciliation problems, so issues are found before members find them.

As an operator,  
I want dashboards and alerts for replication lag, webhooks, queues and reconciliation,  
So that problems are found before members find them.

## Acceptance Criteria

1. **Given** a running Node
   **When** a webhook fails, a queue stalls or replication lags beyond a threshold
   **Then** an alert fires with the space and event id.

## References

- parent — _bmad-output/initiative-ocn/epic-operations-privacy-and-sovereignty-hardening/epic-operations-privacy-and-sovereignty-hardening.md
