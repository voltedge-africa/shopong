---
title: "Observability"
ticket: 4
status: draft
---

## Story and acceptance criteria

As an operator,
I want dashboards and alerts for replication lag, webhooks, queues and reconciliation,
So that problems are found before members find them.

**Acceptance Criteria:**

**Given** a running Node  
**When** a webhook fails, a queue stalls or replication lags beyond a threshold  
**Then** an alert fires with the space and event id.  
