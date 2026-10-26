---
type: initiative
title: "OCN (Open Commerce Network) and Shopong"
parent: none
covers: [FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR8, FR9, FR10, FR11, FR12, FR13, FR14, FR15, FR16, FR17, FR18, FR19, FR20, FR21, FR22, FR23, FR24, FR25, FR26, FR27, FR28, NFR1, NFR2, NFR3, NFR4, NFR5, NFR6, NFR7, NFR8, NFR9, AR1, AR2, AR3, AR4, AR5, AR6, AR7, AR8, AR9, AR10, AR11, AR12, AR13, UX-DR1, UX-DR2, UX-DR3, UX-DR4, UX-DR5]
assignee: ""
status: in-progress
risk: high
---

# OCN (Open Commerce Network) and Shopong

## Description

OCN (Open Commerce Network) is open, modular infrastructure for connected microeconomies in South Africa: stokvels, spaza shops, street and social sellers, suppliers, drivers and funders. People and builders shape it into the tools and workflows that fit them. Shopong is the Expo universal app (iOS, Android and web) that is the first access point to OCN and its first demonstration. The principle: OCN provides the infrastructure; people define the use.

## Outcome

A real stokvel completes a bulk grocery order using only OCN capabilities, with every step visible to every member. A small retailer obtains stock and a funding offer, and the resulting obligations are visible and tracked. A builder who is not on the core team composes a custom workflow over the same capabilities without changing the platform.

## Done when

- Every requirement in the spec (FR1 to FR28, NFR1 to NFR9, AR1 to AR13) is delivered by the epic that owns it, and the provisional UX requirements are confirmed through `bmad-ux` and delivered or parked.
- The three success signals in the product brief are confirmed with the product owner (they are marked to be confirmed) and met by the first demonstration and the builder layer.
- Spike decisions that gate later epics (2.1, 3.1, 4.1, 4.4, 5.1, 6.1, 6.4, 7.1, 11.1) are recorded before the stories that assume them.

## Boundaries

The OCN Node and the Shopong app (iOS, Android, web) with its web console, over the capability ports. Not the third-party services themselves (Ledfra, Stitch, the stablecoin issuers, the LLM providers), which sit behind adapters; the brief's section Out of Scope at This Stage lists what is excluded. Tracer path: the scripted stokvel order from proposal to collection on in-memory adapters (entry 1.4), then the same order on real sandbox adapters.

## References

- product brief — _bmad-output/initiative-ocn/brief-ocn/brief-ocn.md
- architecture — _bmad-output/initiative-ocn/architecture-ocn/architecture-ocn.md (non-negotiable rules and AD-* decisions)
- technology register — _bmad-output/initiative-ocn/spec-ocn/technology-register.md (verified facts, [unverified] items owned by spikes)
- spec — _bmad-output/initiative-ocn/spec-ocn/spec-ocn.md (requirements inventory)

## Notes

- Parked: UX-DR5 (accessible touch targets, contrast, screen-reader labels, more than one South African language) is not placed on any epic; the UX requirements are provisional until `bmad-ux` has run, so the placement waits for the user.
- Open question: the epic prerequisites in the Epic List of the former planning document understated some real ones (for example epic 10 needs delivery and pledge events from epics 7 and 9); the epic notes record each case for the user.
- Open question: the source defines no production target or release process, so no epic's Done when can say "delivered to production" yet; epics 1 and 12 hold the platform baseline and operations, and the user decides where deployment is owned.
- Decision: 2026-10-26 (Demonstration 1 path): (1) the OCN Node holds the record's writers, phones sync to it (epic 3); (2) supplier quotes are typed and ranked by a simple rule, OCR and Laya later (epic 6, story 8.3); (3) Valhalla is tested on the Android emulator before routing is decided (epic 7); (4) the ledger is our own, self-hosted on the OCN Node, closing D-2 (epic 4).
