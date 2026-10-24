---
title: "Create a community space with a deterministic view"
ticket: 2
status: draft
---

## Story and acceptance criteria

As a treasurer,
I want my community to have its own shared record,
So that everything we do is in one place everyone can verify.

**Acceptance Criteria:**

**Given** a new community  
**When** it is created  
**Then** an Autobase is created with the creator as writer and indexer, a Hyperbee view with the defined key spaces, and a versioned `apply`.  

**Given** a recorded event stream  
**When** replayed on two devices in different orders of arrival  
**Then** both produce byte-identical views (property test)  
**And** `apply` uses no wall clock, network or randomness.  
