---
id: 4
type: story
title: "Offline writes that converge"
parent: epic-shared-community-record-hyper-stack
covers: [FR4, NFR1]
after: [1, 2, 3]
refined: false
hitl: false
risk: high
---

# Offline writes that converge

## Description

Members record actions offline for hours and sync later over Hyperswarm, so poor connectivity does not stop the group, and events the group has not yet seen are marked on the device.

As a member in a low-signal area,  
I want to record actions offline and have them sync later,  
So that bad connectivity does not stop the group.

## Acceptance Criteria

1. **Given** two devices that diverge offline for an hour with different writes
   **When** they reconnect over Hyperswarm
   **Then** both converge to the same view with no lost events
   **And** the UI marks events as "on your phone" until the group has seen them.

## References

- parent — _bmad-output/initiative-ocn/epic-shared-community-record-hyper-stack/epic-shared-community-record-hyper-stack.md
