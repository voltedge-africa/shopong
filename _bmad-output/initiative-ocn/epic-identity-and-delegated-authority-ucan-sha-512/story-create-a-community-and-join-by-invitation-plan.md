---
title: "Create a community and join by invitation"
ticket: 3
status: draft
---

## Story and acceptance criteria

As a treasurer,
I want to create a community and invite members with a link or code,
So that only people I invite can join.

**Acceptance Criteria:**

**Given** I created the community  
**When** I invite someone  
**Then** an invitation UCAN is issued for their DID or an open single-use code, with a short expiry and `member/join`.  

**Given** a newcomer presents a valid invitation  
**When** they join  
**Then** the join is verified offline and recorded as a `member.joined` event  
**And** an expired or reused invitation is rejected with a clear reason.  
