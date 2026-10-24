---
id: 1
type: spike
title: "Hypercore stack in a Bare worklet inside Expo"
parent: epic-shared-community-record-hyper-stack
covers: [AR3, AR11, NFR2]
after: [1.1]
refined: false
hitl: false
risk: high
---

# Hypercore stack in a Bare worklet inside Expo

## Description

Measures whether Corestore, Autobase, Hyperbee, Hyperdrive and Hyperswarm run in a react-native-bare-kit worklet on low-end iOS and Android, including start-up, memory, battery and iOS background suspension, and selects the Node-held-writers fallback if the budget fails.

As a builder,  
I want to know whether Corestore, Autobase, Hyperbee, Hyperdrive and Hyperswarm run in a `react-native-bare-kit` worklet on low-end Android and iOS,  
So that we choose the mobile architecture with evidence.

## Acceptance Criteria

1. **Given** an Expo app with `react-native-bare-kit` 0.16.0, a `bare-pack` bundle and native addons linked with `bare-link`
   **When** a worklet opens a Corestore, an Autobase with a Hyperbee view and a Hyperswarm connection to a Node, and the UI calls it through a typed RPC (hyperschema + bare-rpc)
   **Then** I record start-up time, memory (with `memoryLimit`), battery over 30 minutes and sync success on the device baseline
   **And** I record the effect of the known 0.16.0 bugs (`start(filename)` without args, static `Worklet.wakeup()`) and their workarounds.
2. **Given** the app is backgrounded on iOS
   **When** the worklet is suspended and resumed with `update()`
   **Then** I record what survives within the OS's roughly 30 second allowance and that sync resumes correctly.
3. **Given** the results
   **When** they fail the budget
   **Then** the decision record selects the fallback (Node-held writers over WebSocket) and updates architecture AD-14.

## References

- parent — _bmad-output/initiative-ocn/epic-shared-community-record-hyper-stack/epic-shared-community-record-hyper-stack.md
- architecture-ocn/architecture-ocn.md#ad-14
