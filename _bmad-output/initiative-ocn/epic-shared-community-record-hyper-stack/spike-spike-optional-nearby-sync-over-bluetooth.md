---
id: 9
type: spike
title: "Spike (optional): nearby sync over Bluetooth"
parent: epic-shared-community-record-hyper-stack
covers: [AR3, NFR1]
after: [1]
refined: false
hitl: false
risk: high
---

# Spike (optional): nearby sync over Bluetooth

## Description

Tests whether two phones can exchange a Corestore replication stream over Bluetooth L2CAP with no internet, so a stokvel meeting can sync with no coverage, and if that is not workable the decision drops it or limits it to a small sync hint.

As a member in a place with no data coverage,  
I want devices in the same room to exchange community updates directly,  
So that a stokvel meeting can work with no internet at all.

## Acceptance Criteria

1. **Given** two phones running a Bare worklet with `bare-bluetooth`
   **When** one advertises a GATT service and the other connects and opens an L2CAP channel
   **Then** I record whether a Corestore replication stream can run over the channel, its throughput and the permissions required on iOS and Android.
2. **Given** the result
   **When** replication over BLE is not workable
   **Then** the decision record drops it or limits it to exchanging a small "sync hint" and the offline story stays as in 3.4.

## References

- parent — _bmad-output/initiative-ocn/epic-shared-community-record-hyper-stack/epic-shared-community-record-hyper-stack.md
