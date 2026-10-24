---
id: 3
type: story
title: "Request funding for a stock order"
parent: epic-demonstration-2-small-retailer-stock-and-funding
covers: [FR19]
after: [2, 8.2]
refined: false
hitl: false
risk: medium
---

# Request funding for a stock order

## Description

A retailer requests funding for a stock order, visible to holders of funding/offer, and can attach their verifiable track record if they choose.

As a retailer,  
I want to ask funders to help pay for stock,  
So that I can buy more than my cash allows.

## Acceptance Criteria

1. **Given** a stock order
   **When** I request funding
   **Then** a `funding.requested` event is visible to holders of `funding/offer`
   **And** I can attach my verifiable record (story 10.5) if I choose.

## References

- parent — _bmad-output/initiative-ocn/epic-demonstration-2-small-retailer-stock-and-funding/epic-demonstration-2-small-retailer-stock-and-funding.md
