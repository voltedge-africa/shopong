---
title: "Roles with limits as delegated capabilities"
ticket: 4
status: draft
---

## Story and acceptance criteria

As a treasurer,
I want to grant roles such as co-treasurer, driver or supplier with limits,
So that people can act for the group only as far as I allow.

**Acceptance Criteria:**

**Given** I hold `payment/approve` with a ceiling  
**When** I delegate it to another member with a lower ceiling  
**Then** the delegation is accepted  
**And** a delegation with a higher ceiling or a wider resource is rejected by the attenuation rules.  

**Given** a delegated role has an expiry  
**When** the expiry passes  
**Then** the holder can no longer act and the app says why.  
