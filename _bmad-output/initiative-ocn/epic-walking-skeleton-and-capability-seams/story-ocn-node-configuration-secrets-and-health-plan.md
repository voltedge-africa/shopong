---
title: "OCN Node configuration, secrets and health"
ticket: 5
status: done
---

## Story and acceptance criteria

As an operator,
I want the OCN Node to load configuration and secrets safely and expose health and metrics,
So that credentials never reach devices and I can see the Node is working.

**Acceptance Criteria:**

**Given** a Node started with a config file and secret environment variables  
**When** a required secret is missing  
**Then** it refuses to start and names the missing key without printing any secret values.  

**Given** a running Node  
**When** I request `/health`  
**Then** it returns component status for the record, ledger, payments and queue.  
