---
id: 2
type: story
title: "OCN Capability MCP server with authority checks"
parent: epic-builder-layer-agents-and-generated-interfaces
covers: [FR26, AR13]
after: [2.4, 2.5]
refined: false
hitl: true
risk: high
---

# OCN Capability MCP server with authority checks

## Description

Exposes the platform's capabilities once as an MCP server in which every tool has a schema, a required ability and a read, write or money classification, and a money tool returns needs-confirmation and performs nothing until the member approves.

As a builder,  
I want the platform's capabilities exposed once as an MCP server in which every tool requires a UCAN,  
So that any agent runtime can use them and none can exceed the person's authority.

## Acceptance Criteria

1. **Given** the ports
   **When** the MCP server is generated
   **Then** each tool has a schema, a required ability and a read/write/money classification
   **And** a call without the right authority is refused with a reason.
2. **Given** a money-classified tool
   **When** an agent calls it
   **Then** the server returns `needs-confirmation` and performs nothing until the member approves in the UI.

## References

- parent — _bmad-output/initiative-ocn/epic-builder-layer-agents-and-generated-interfaces/epic-builder-layer-agents-and-generated-interfaces.md
- architecture-ocn/architecture-ocn.md#ad-17
