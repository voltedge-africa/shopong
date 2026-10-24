---
id: 3
type: story
title: "Sandboxed agent sessions with narrower authority"
parent: epic-builder-layer-agents-and-generated-interfaces
covers: [FR26, NFR5, AR13]
after: [1, 2, 2.4, 2.5, 3.2]
refined: false
hitl: false
risk: high
---

# Sandboxed agent sessions with narrower authority

## Description

Runs each agent session in a sandbox with deny-by-default permissions, network only to the capability MCP server and a model endpoint, and a short-lived UCAN strictly narrower than the member's, appending session actions as agent.action events.

As an operator,  
I want agent sessions isolated and given less authority than the person,  
So that a prompt-injected agent cannot do harm.

## Acceptance Criteria

1. **Given** a request from a member
   **When** the Node starts a session
   **Then** the agent runtime runs in a sandbox with no network except the Node's capability MCP server and a model endpoint, a deny-by-default permission config, a server password, and a short-lived UCAN strictly narrower than the member's
   **And** the session's actions are appended as `agent.action` events.
2. **Given** an agent that tries a built-in tool such as `bash` or `edit`
   **When** it is called
   **Then** the permission config refuses it and the attempt is logged.

## References

- parent — _bmad-output/initiative-ocn/epic-builder-layer-agents-and-generated-interfaces/epic-builder-layer-agents-and-generated-interfaces.md
- architecture-ocn/architecture-ocn.md#ad-10
- architecture-ocn/architecture-ocn.md#ad-17
