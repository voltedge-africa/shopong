---
title: "Revocation, key loss and recovery"
ticket: 6
status: draft
---

## Story and acceptance criteria

As a member,
I want to recover my identity and my writer keys if I lose my phone, and the group to cut off a lost key,
So that losing a device is not a disaster or a breach.

**Acceptance Criteria:**

**Given** a recovery phrase from which the identity seed and the Corestore `primaryKey` are derived with a KDF
**When** I restore on a new device
**Then** my DID and my writer cores' keys are recovered, so I rejoin each community as the same writer
**And** the KDF design (including the `unsafe: true` requirement for setting `primaryKey` on a root store) has been reviewed.  

**Given** a lost device that cannot be recovered and two named trustees
**When** the trustees re-delegate my role to a new key
**Then** the old key's authority is revoked by a `role.revoked` event that `isRevoked` honours
**And** the action is refused everywhere from the next sync.
