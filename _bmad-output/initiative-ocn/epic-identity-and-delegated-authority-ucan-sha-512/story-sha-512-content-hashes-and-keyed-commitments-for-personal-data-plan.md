---
title: "SHA-512 content hashes and keyed commitments for personal data"
ticket: 7
status: draft
---

## Story and acceptance criteria

As a member,
I want my phone number and ID never to be written to the shared record,
So that my privacy is protected while the group can still match people.

**Acceptance Criteria:**

**Given** a phone number  
**When** the app needs it in the record  
**Then** only `HMAC-SHA512(communitySecret, normalised value)` is stored  
**And** the HMAC comes from an audited library because expo-crypto has no HMAC.  

**Given** a document or photo  
**When** it is attached  
**Then** its SHA-512 is computed with expo-crypto and stored in the event  
**And** a recipient can re-hash the file and see "verified" or "does not match".  
