---
id: 3
type: story
title: "Admit and remove writers by capability"
parent: epic-shared-community-record-hyper-stack
covers: [FR2]
after: [2, 2.3, 2.5]
refined: false
hitl: false
risk: high
---

# Admit and remove writers by capability

## Description

New members' devices become writers only through a valid invitation UCAN chain, and removing a member removes their writer key but never the last indexer.

As a treasurer,  
I want new members' devices to become writers only with a valid invitation,  
So that the record cannot be written by outsiders.

## Acceptance Criteria

1. **Given** a valid `member.joined` event with a UCAN chain
   **When** `apply` runs
   **Then** it calls `host.addWriter` for the member's writer key
   **And** removing a member calls `host.removeWriter` and refuses to remove the last indexer.

## References

- parent — _bmad-output/initiative-ocn/epic-shared-community-record-hyper-stack/epic-shared-community-record-hyper-stack.md
