---
title: "Product Brief: OCN (Open Commerce Network) and Shopong"
status: draft
created: 2026-10-24
updated: 2026-10-24
inputs:
  - docs/source/ocn-shopong-project-spine.pdf
  - docs/source/technology-stack-diagram.png
  - docs/source/technology-links.docx
---

# Product Brief: OCN and Shopong

## Executive Summary

There are too many apps. Every community and small business has different needs, and a closed one-size-fits-all app serves almost none of them well. **OCN (Open Commerce Network)** is open, modular infrastructure that people and builders shape into the tools and workflows that fit them. **Shopong** is the access point: one way to reach OCN, and the first demonstration of it. Shopong does not define the platform's limits.

The principle: **OCN provides the infrastructure. People define the use.**

## The Problem

South Africa's local economy runs on stokvels, spaza shops, street sellers and social sellers, and the young entrepreneurs who sell through TikTok, Instagram and WhatsApp. None of them are connected. Stokvels run on personal trust. Spazas and street sellers pay wholesaler markups. Social sellers lack reliable stock and trusted payment. Cash and carries cannot reach or verify small buyers. Each group has money, demand and local knowledge, but no shared, verifiable way to coordinate.

## The Solution

A foundation for connected microeconomies, built from four connected capabilities plus a builder layer:

| Capability | What it gives people |
|---|---|
| **Identity** | Participants and accountability: verifiable identities and the authority to act for a group |
| **Data** | Shared information and records: a transparent, replicated record that works offline |
| **Finance** | Payments and pooled funds: collect, hold, pay and reconcile money |
| **Logistics** | Movement of goods: where things are, how they get there, proof they arrived |
| **Intelligence** (builder layer, shown in the stack diagram) | AI agents and generated interfaces so builders can compose custom solutions over the four capabilities |

## The Project Spine

1. **Digital sovereignty**: people choose how they organise, interact, trade and coordinate.
2. **Open, modular infrastructure**: shared capabilities builders combine without a prescribed workflow.
3. **Social economic coordination**: individuals, communities, small businesses, buyers, sellers, suppliers, drivers and funders connect around real needs.
4. **Trust and accountability**: transparent transactions, verifiable identities, clear obligations, reliable fulfilment.
5. **Stronger microeconomies**: communities gain purchasing power; small businesses gain stock, capital, markets and delivery.

Microeconomics is the focus. Digital sovereignty is the foundation. Transparency is how trust is earned.

## First Demonstration: Everyday Commerce

- **Community stokvel**: members coordinate a bulk grocery purchase, compare supplier options, pool funds for payment, and arrange delivery to a shared collection point.
- **Small retailer**: a shop owner finds suppliers and potential funding, gets stock delivered, sells goods, and tracks the obligations that follow.

## Who It Serves

Stokvel members and treasurers; spaza and small-shop owners; street and social sellers (especially young entrepreneurs); suppliers and cash-and-carries; drivers; funders; and builders who compose new workflows on OCN.

## Success Signals (to be confirmed with the product owner)

- A real stokvel completes a bulk order (propose, compare, pool funds, pay, deliver, collect) using only OCN capabilities, with every step visible to every member.
- A small retailer obtains stock and a funding offer, and the resulting obligations are visible and tracked.
- A builder who is not on the core team composes a custom workflow over the same capabilities without changing the platform.

## Out of Scope at This Stage

Decided later with the product owner: multi-country operation, a consumer stablecoin wallet product, fully custom hardware for drivers, and any lock-in to a single workflow in Shopong.

## Source Notes

Built from the Project Spine PDF, the technology-stack diagram and the technology links document. The diagram shows an Intelligence layer that the PDF does not list among its four capabilities; this brief treats it as the builder layer (see architecture AD-16). The tech-by-tech plan is in `architecture.md`; the verified facts per technology are in `technology-register.md`.
