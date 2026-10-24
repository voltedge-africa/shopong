---
type: epic
title: "Demonstration 1: stokvel bulk order"
parent: initiative-ocn
covers: [FR2, FR6, FR8, FR9, FR11, FR16, NFR1, UX-DR1]
assignee: ""
risk: high
---

# Demonstration 1: stokvel bulk order

## Description

A real stokvel completes a bulk grocery purchase using OCN capabilities: propose, compare, pool funds, pay, deliver to a shared collection point and settle, with every step visible to every member.

## Outcome

A stokvel treasurer and its members complete one bulk grocery purchase from proposal to settled order inside Shopong, so that the stokvel's money and delivery are visible to every member, with the funding bar, supplier-paid status and per-member cost summary as the signal.

## Requirements

- FR2: A person can create a community space (for example a stokvel) and invite members into it.
- FR6: A member can propose a bulk order with a budget and a deadline.
- FR8: Supplier options can be compared, with ranked suggestions and a stated confidence.
- FR9: Members can pledge and pay their contribution through a South African bank payment.
- FR11: The pool can pay a supplier once the required approvals are given.
- FR16: Delivery and collection are confirmed with proof (who, where, when, photo) that triggers the next step.
- NFR1: Core community flows (propose, pledge, view, confirm delivery) work offline and converge without data loss when devices reconnect.
- UX-DR1: Plain-language flows a stokvel treasurer can follow without training; money states shown in clear words (requested, paid, failed, refunded).

## Done when

1. A treasurer creates a stokvel and invites members, and a member's bulk order with its budget and deadline appears to every member once proposed.
2. Members compare at least two reviewed supplier quotes with the ranked suggestion and its confidence, and the treasurer's selection is recorded.
3. Members pledge and pay through Stitch, the funding bar updates for everyone, and an unpaid member is shown as unpaid without bank details.
4. With a funded pool and the required approvals, the supplier is paid and every member sees supplier paid, with the ledger and the record in agreement.
5. The order is delivered to the shared collection point and closes after each member confirms collection, with a per-member cost summary and full timeline.
6. On the production deployment, the creator's offline changes sync and converge when devices reconnect.

## Boundaries

The stokvel bulk-order flow end to end, as the first demonstration of OCN capabilities. Not the capabilities it uses: identity, invitation and approval authority (epic 2), the community record (epic 3), Stitch pay-ins and the pool (epic 4), OCR and quote ranking (epic 6), and routes and proof of delivery (epic 7). Not the small-retailer flow (epic 9).

## References

- parent — ../initiative-ocn.md, section Epics
- spec — ../spec-ocn/spec-ocn.md, section Requirements Inventory (FR2, FR6, FR8, FR9, FR11, FR16, NFR1, UX-DR1)
- constraint — ../architecture-ocn/architecture-ocn.md, section 5.1 (stokvel bulk order flow), AD-13 (Stitch is the fiat rail for this demo) and AD-15 (mobile payments open in an in-app browser tab, not a raw WebView)
- constraint — ../architecture-ocn/architecture-ocn.md, AD-3 (the OCN Node is the only writer to Stitch and the ledger; no credentials on devices)

## Notes

- Tracer: 8.1 (start a stokvel and invite members) is the thinnest path: one stokvel created, one member invited, and both written to the community record.
- Waits on epic 2 because: creating, inviting members and approving proposals need identity, invitation and approval authority (2.3, 2.4).
- Waits on epic 3 because: every order step is written to the community record (3.2, pinned by 8.1).
- Waits on epic 4 because: Stitch pay-ins (4.3) and the pool's supplier payment (4.7) move the money.
- Waits on epic 6 because: structured quotes and their ranking (6.3, 6.5) are what members compare.
- Waits on epic 7 because: the route (7.4) and collection proof (7.6) complete the delivery and close.
- Assumption: entry 6 claims no requirement id; it is the delivery integration of FR15, which epic 7 owns.
- Assumption: UX-DR1 is provisional, since no UX design exists yet; confirm with bmad-ux.
- Open question: entry 8.7 creates open obligations for follow-up, which FR20 places in epic 10, and this epic does not wait on epic 10; the user decides whether to add that wait or drop obligations from this demo's close.
- Open question: no Refactor sweep story is planned (the standard asks for one when an epic has more than three entries); the user decides whether to add it.
