---
title: "OCN component library for generated interfaces"
ticket: 4
status: draft
---

## Story and acceptance criteria

As a builder,
I want an approved set of components the model may use,
So that generated screens look native and cannot do arbitrary things.

**Acceptance Criteria:**

**Given** `createLibrary` with Stack, Metric, Table, Form, Timeline, Map, Chart, ActionButton, MemberList, QuoteCompare and PledgeProgress  
**When** I run `generate --spec` and `generateSystemPrompt` locally  
**Then** the spec and prompt are produced without any hosted service  
**And** each component declares which capability read or action it may bind to.  
