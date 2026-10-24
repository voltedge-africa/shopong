---
title: "Model routing and local fallback"
ticket: 9
status: draft
---

## Story and acceptance criteria

As an operator,
I want to choose models per task with a local fallback and cost caps,
So that we stay affordable and sovereign.

**Acceptance Criteria:**

**Given** configured providers and a local OpenAI-compatible endpoint  
**When** a hosted provider fails or the cap is hit  
**Then** the Node falls back to the local model or refuses with a clear message  
**And** prompts carry no raw personal data and payloads are not logged.  
