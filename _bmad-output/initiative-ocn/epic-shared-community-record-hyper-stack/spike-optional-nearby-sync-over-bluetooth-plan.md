---
title: "Spike (optional): nearby sync over Bluetooth"
ticket: 9
status: draft
---

## Story and acceptance criteria

As a member in a place with no data coverage,
I want devices in the same room to exchange community updates directly,
So that a stokvel meeting can work with no internet at all.

**Acceptance Criteria:**

**Given** two phones running a Bare worklet with `bare-bluetooth`
**When** one advertises a GATT service and the other connects and opens an L2CAP channel
**Then** I record whether a Corestore replication stream can run over the channel, its throughput and the permissions required on iOS and Android.  

**Given** the result
**When** replication over BLE is not workable
**Then** the decision record drops it or limits it to exchanging a small "sync hint" and the offline story stays as in 3.4.
