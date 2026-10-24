---
title: "Files and photos in Hyperdrive with hash references"
ticket: 7
status: draft
---

## Story and acceptance criteria

As a member,
I want to attach price lists, receipts and delivery photos to the record,
So that anyone can verify what was shown.

**Acceptance Criteria:**

**Given** a file added to the community's drive with `metadata: { sha512 }`
**When** its event is written
**Then** the event holds the drive key, path and SHA-512
**And** a receiving device fetches the file lazily with `download(folder)` and verifies the hash.  

**Given** a phone running low on storage
**When** a blob is no longer needed locally
**Then** it is freed with `clear(path)` and re-fetched on demand (`has(path)` shows the state)
**And** large files are streamed and the largest tested size on the device baseline is recorded.
