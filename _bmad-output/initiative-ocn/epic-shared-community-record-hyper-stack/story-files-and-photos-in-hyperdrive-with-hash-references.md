---
id: 7
type: story
title: "Files and photos in Hyperdrive with hash references"
parent: epic-shared-community-record-hyper-stack
covers: [FR5, NFR9]
after: [1, 2, 1.3]
refined: false
hitl: false
risk: high
---

# Files and photos in Hyperdrive with hash references

## Description

Attaches price lists, receipts and delivery photos to the record as Hyperdrive files whose events carry a SHA-512, fetched lazily and freed on low storage, with large files streamed.

As a member,  
I want to attach price lists, receipts and delivery photos to the record,  
So that anyone can verify what was shown.

## Acceptance Criteria

1. **Given** a file added to the community's drive with `metadata: { sha512 }`
   **When** its event is written
   **Then** the event holds the drive key, path and SHA-512
   **And** a receiving device fetches the file lazily with `download(folder)` and verifies the hash.
2. **Given** a phone running low on storage
   **When** a blob is no longer needed locally
   **Then** it is freed with `clear(path)` and re-fetched on demand (`has(path)` shows the state)
   **And** large files are streamed and the largest tested size on the device baseline is recorded.

## References

- parent — _bmad-output/initiative-ocn/epic-shared-community-record-hyper-stack/epic-shared-community-record-hyper-stack.md
- architecture-ocn/architecture-ocn.md#6-data-and-identifiers
