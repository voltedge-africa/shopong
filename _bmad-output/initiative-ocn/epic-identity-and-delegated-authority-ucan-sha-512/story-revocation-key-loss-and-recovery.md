---
id: 6
type: story
title: "Revocation, key loss and recovery"
parent: epic-identity-and-delegated-authority-ucan-sha-512
covers: [FR28, FR3, AR12]
after: [2, 4, 5, 1.3]
refined: false
hitl: true
risk: high
---

# Revocation, key loss and recovery

## Description

A member recovers their identity and writer keys from a recovery phrase on a new device, and two named trustees can revoke a lost key and re-delegate the role, with revoked keys refused everywhere from the next sync.

As a member,  
I want to recover my identity and my writer keys if I lose my phone, and the group to cut off a lost key,  
So that losing a device is not a disaster or a breach.

## Acceptance Criteria

1. **Given** a recovery phrase from which the identity seed and the Corestore `primaryKey` are derived with a KDF
   **When** I restore on a new device
   **Then** my DID and my writer cores' keys are recovered, so I rejoin each community as the same writer
   **And** the KDF design (including the `unsafe: true` requirement for setting `primaryKey` on a root store) has been reviewed.
2. **Given** a lost device that cannot be recovered and two named trustees
   **When** the trustees re-delegate my role to a new key
   **Then** the old key's authority is revoked by a `role.revoked` event that `isRevoked` honours
   **And** the action is refused everywhere from the next sync.

## References

- parent — _bmad-output/initiative-ocn/epic-identity-and-delegated-authority-ucan-sha-512/epic-identity-and-delegated-authority-ucan-sha-512.md
- architecture-ocn/architecture-ocn.md#ad-18
