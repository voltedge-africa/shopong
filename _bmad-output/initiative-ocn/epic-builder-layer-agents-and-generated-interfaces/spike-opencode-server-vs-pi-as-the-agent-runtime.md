---
id: 1
type: spike
title: "OpenCode server vs Pi as the agent runtime"
parent: epic-builder-layer-agents-and-generated-interfaces
covers: [AR3]
after: []
refined: false
hitl: false
risk: high
---

# OpenCode server vs Pi as the agent runtime

## Description

Compares OpenCode server mode with Pi for running agent sessions on the OCN Node, covering denial of built-in tools, permission requests, custom and MCP tools, and tool calls on a local model, and confirms or reverses AD-10 in decision D-9.

As a builder,  
I want to compare OpenCode in server mode and Pi for running agent sessions on the OCN Node,  
So that we choose one runtime with evidence.

## Acceptance Criteria

1. **Given** a sandbox and a stub capability MCP server
   **When** I run a session in OpenCode (`opencode serve` with `OPENCODE_SERVER_PASSWORD`, `permission: {"*": "deny"}` plus allow-rules for the MCP server's tools, `@opencode-ai/sdk`, SSE events, permission requests) and in Pi (`createAgentSession`, `customTools`/`pi.registerTool()`, MCP extension)
   **Then** I record how each denies built-in tools, how permission requests surface in SDK mode, how a custom tool or MCP tool is defined, and the effort to sandbox.
2. **Given** a local OpenAI-compatible endpoint (for example vLLM)
   **When** each runtime is pointed at it (`@ai-sdk/openai-compatible` `baseURL` for OpenCode; `models.json` for Pi)
   **Then** I record whether tool calls work and the model-size floor that makes them reliable.
3. **Given** the findings
   **When** compared
   **Then** decision AD-10 (leaning OpenCode) is confirmed or reversed and D-9 is recorded.

## References

- parent — _bmad-output/initiative-ocn/epic-builder-layer-agents-and-generated-interfaces/epic-builder-layer-agents-and-generated-interfaces.md
- architecture-ocn/architecture-ocn.md#ad-10
