---
id: 1
type: spike
title: "UCAN library on Expo (ts-ucan vs iso-ucan)"
parent: epic-identity-and-delegated-authority-ucan-sha-512
covers: [AR3, AR1]
after: [1.1, 1.2]
refined: false
hitl: false
risk: high
---

# UCAN library on Expo (ts-ucan vs iso-ucan)

## Description

Tests whether ts-ucan or iso-ucan builds, signs and verifies capability chains in an Expo app on iOS, Android and web and what their maintenance risk is, ending in a decision record that names the library and its exit path.

As a builder,  
I want to know whether ts-ucan builds, signs and verifies capability chains in an Expo app and what its maintenance risk is,  
So that we commit to a library with evidence.

## Acceptance Criteria

1. **Given** an Expo app on iOS, Android and web
   **When** I run `EdKeypair.create`, `build` with proofs, `encode` and `verify` using `@ucans/ucans` 0.12.0
   **Then** I record whether each works on each platform and any polyfills needed.
2. **Given** the same scenario using `iso-ucan` 2.0.0
   **When** I compare the two
   **Then** a decision record states the chosen library, the risks (2023 publish date, spec version) and the exit path via the `CapabilityAuth` port.

## References

- parent — _bmad-output/initiative-ocn/epic-identity-and-delegated-authority-ucan-sha-512/epic-identity-and-delegated-authority-ucan-sha-512.md
- architecture-ocn/architecture-ocn.md#41-identity-who-may-do-what
