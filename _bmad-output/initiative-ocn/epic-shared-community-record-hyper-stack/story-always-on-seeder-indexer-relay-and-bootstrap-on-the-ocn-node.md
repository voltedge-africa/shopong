---
id: 5
type: story
title: "Always-on seeder, indexer, relay and bootstrap on the OCN Node"
parent: epic-shared-community-record-hyper-stack
covers: [FR4]
after: [1, 2, 1.1]
refined: false
hitl: false
risk: high
---

# Always-on seeder, indexer, relay and bootstrap on the OCN Node

## Description

The OCN Node replicates each space, acknowledges writes, serves the full record and relays connections for devices behind NAT, so the record stays available when phones are off, and clients also list the Node's bootstrap.

As a member,  
I want the record to stay available when my phone is off or in the background,  
So that I can catch up from any device.

## Acceptance Criteria

1. **Given** the Node joins a space's swarm topic
   **When** members write
   **Then** the Node replicates with `base.replicate(conn)`, acks (`base.ack()`) and serves the full record.
2. **Given** a device behind carrier-grade NAT
   **When** a direct connection fails
   **Then** it syncs through the Node's relay (`relayThrough`)
   **And** clients list the Node's own HyperDHT bootstrap (`DHT.bootstrapper`) alongside the default public bootstrap nodes.
3. **Given** the HyperDHT `firewall` callback
   **When** a non-member dials the Node
   **Then** a test confirms which return value blocks (the docs contradict themselves) and the Node refuses the stranger.

## References

- parent — _bmad-output/initiative-ocn/epic-shared-community-record-hyper-stack/epic-shared-community-record-hyper-stack.md
- architecture-ocn/architecture-ocn.md#ad-19
