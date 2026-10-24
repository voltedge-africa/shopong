---
title: "Sandboxed agent sessions with narrower authority"
ticket: 3
status: draft
---

## Story and acceptance criteria

As an operator,
I want agent sessions isolated and given less authority than the person,
So that a prompt-injected agent cannot do harm.

**Acceptance Criteria:**

**Given** a request from a member
**When** the Node starts a session
**Then** the agent runtime runs in a sandbox with no network except the Node's capability MCP server and a model endpoint, a deny-by-default permission config, a server password, and a short-lived UCAN strictly narrower than the member's
**And** the session's actions are appended as `agent.action` events.  

**Given** an agent that tries a built-in tool such as `bash` or `edit`
**When** it is called
**Then** the permission config refuses it and the attempt is logged.
