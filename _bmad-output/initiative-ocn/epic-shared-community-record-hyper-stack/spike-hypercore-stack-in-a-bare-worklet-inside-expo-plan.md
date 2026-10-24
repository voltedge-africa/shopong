---
title: "Spike: Hypercore stack in a Bare worklet inside Expo"
ticket: 1
status: in-progress
---

## Story and acceptance criteria

As a builder,
I want to know whether Corestore, Autobase, Hyperbee, Hyperdrive and Hyperswarm run in a `react-native-bare-kit` worklet on low-end Android and iOS,
So that we choose the mobile architecture with evidence.

**Acceptance Criteria:**

**Given** an Expo app with `react-native-bare-kit` 0.16.0, a `bare-pack` bundle and native addons linked with `bare-link`
**When** a worklet opens a Corestore, an Autobase with a Hyperbee view and a Hyperswarm connection to a Node, and the UI calls it through a typed RPC (hyperschema + bare-rpc)
**Then** I record start-up time, memory (with `memoryLimit`), battery over 30 minutes and sync success on the device baseline
**And** I record the effect of the known 0.16.0 bugs (`start(filename)` without args, static `Worklet.wakeup()`) and their workarounds.  

**Given** the app is backgrounded on iOS
**When** the worklet is suspended and resumed with `update()`
**Then** I record what survives within the OS's roughly 30 second allowance and that sync resumes correctly.  

**Given** the results
**When** they fail the budget
**Then** the decision record selects the fallback (Node-held writers over WebSocket) and updates architecture AD-14.
