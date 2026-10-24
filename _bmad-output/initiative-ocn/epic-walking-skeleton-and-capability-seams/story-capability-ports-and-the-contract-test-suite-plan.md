---
title: "Capability ports and the contract test suite"
ticket: 2
status: done
---

## Story and acceptance criteria

As a builder,
I want typed ports for each capability with a shared contract test suite,
So that any adapter, real or fake, is proven to behave the same way.

**Acceptance Criteria:**

**Given** the ports `CapabilityAuth`, `SharedRecord`, `Ledger`, `PayIn`, `PayOut`, `StableRail`, `Ocr`, `Decide`, `Routing`, `Geo`, `Agent`, `GenUi`  
**When** I read the shared package  
**Then** each port has a documented interface and an in-memory adapter.  

**Given** a port's contract suite  
**When** I run it against the in-memory adapter  
**Then** it passes  
**And** the suite can be pointed at a real adapter later without edits.  
