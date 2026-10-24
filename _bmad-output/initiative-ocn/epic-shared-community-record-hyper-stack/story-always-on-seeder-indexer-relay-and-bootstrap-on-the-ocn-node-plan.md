---
title: "Always-on seeder, indexer, relay and bootstrap on the OCN Node"
ticket: 5
status: draft
---

## Story and acceptance criteria

As a member,
I want the record to stay available when my phone is off or in the background,
So that I can catch up from any device.

**Acceptance Criteria:**

**Given** the Node joins a space's swarm topic
**When** members write
**Then** the Node replicates with `base.replicate(conn)`, acks (`base.ack()`) and serves the full record.  

**Given** a device behind carrier-grade NAT
**When** a direct connection fails
**Then** it syncs through the Node's relay (`relayThrough`)
**And** clients list the Node's own HyperDHT bootstrap (`DHT.bootstrapper`) alongside the default public bootstrap nodes.  

**Given** the HyperDHT `firewall` callback
**When** a non-member dials the Node
**Then** a test confirms which return value blocks (the docs contradict themselves) and the Node refuses the stranger.
