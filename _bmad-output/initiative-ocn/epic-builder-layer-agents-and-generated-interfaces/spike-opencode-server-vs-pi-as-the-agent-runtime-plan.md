---
title: "Spike: OpenCode server vs Pi as the agent runtime"
ticket: 1
status: draft
---

## Story and acceptance criteria

As a builder,
I want to compare OpenCode in server mode and Pi for running agent sessions on the OCN Node,
So that we choose one runtime with evidence.

**Acceptance Criteria:**

**Given** a sandbox and a stub capability MCP server
**When** I run a session in OpenCode (`opencode serve` with `OPENCODE_SERVER_PASSWORD`, `permission: {"*": "deny"}` plus allow-rules for the MCP server's tools, `@opencode-ai/sdk`, SSE events, permission requests) and in Pi (`createAgentSession`, `customTools`/`pi.registerTool()`, MCP extension)
**Then** I record how each denies built-in tools, how permission requests surface in SDK mode, how a custom tool or MCP tool is defined, and the effort to sandbox.  

**Given** a local OpenAI-compatible endpoint (for example vLLM)
**When** each runtime is pointed at it (`@ai-sdk/openai-compatible` `baseURL` for OpenCode; `models.json` for Pi)
**Then** I record whether tool calls work and the model-size floor that makes them reliable.  

**Given** the findings
**When** compared
**Then** decision AD-10 (leaning OpenCode) is confirmed or reversed and D-9 is recorded.
