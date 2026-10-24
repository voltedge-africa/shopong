---
title: "OCN Capability MCP server with authority checks"
ticket: 2
status: draft
---

## Story and acceptance criteria

As a builder,
I want the platform's capabilities exposed once as an MCP server in which every tool requires a UCAN,
So that any agent runtime can use them and none can exceed the person's authority.

**Acceptance Criteria:**

**Given** the ports
**When** the MCP server is generated
**Then** each tool has a schema, a required ability and a read/write/money classification
**And** a call without the right authority is refused with a reason.  

**Given** a money-classified tool
**When** an agent calls it
**Then** the server returns `needs-confirmation` and performs nothing until the member approves in the UI.
