---
title: "Spike: UCAN library on Expo (ts-ucan vs iso-ucan)"
ticket: 1
status: in-progress
---

## Story and acceptance criteria

As a builder,
I want to know whether ts-ucan builds, signs and verifies capability chains in an Expo app and what its maintenance risk is,
So that we commit to a library with evidence.

**Acceptance Criteria:**

**Given** an Expo app on iOS, Android and web  
**When** I run `EdKeypair.create`, `build` with proofs, `encode` and `verify` using `@ucans/ucans` 0.12.0  
**Then** I record whether each works on each platform and any polyfills needed.  

**Given** the same scenario using `iso-ucan` 2.0.0  
**When** I compare the two  
**Then** a decision record states the chosen library, the risks (2023 publish date, spec version) and the exit path via the `CapabilityAuth` port.  
