---
type: epic
title: "Demonstration 2: small retailer stock and funding"
parent: initiative-ocn
covers: [FR18, FR19, FR20]
assignee: ""
risk: high
---

# Demonstration 2: small retailer stock and funding

## Description

A shop owner finds suppliers and potential funding, gets stock delivered, sells goods and tracks the obligations that follow.

## Outcome

For a small shop owner, finding suppliers, getting funding for stock and tracking what is owed happen in one place, so that the shop can restock and repay on time; the signal is a funded stock order settled through a Stitch pay-in.

## Requirements

- FR18: A small retailer can build a verifiable profile and find suppliers and stock offers.
- FR19: A retailer can request funding; funders can offer; acceptance creates obligations.
- FR20: Obligations (who owes whom what by when) are derived from events and tracked until settled.

## Done when

1. A retailer's profile, signed by their DID and showing only the fields they chose, can be invited by a supplier circle, and offers are searchable by item with price history and delivery record.
2. A retailer requests funding for a stock order, a funder sees it and makes an offer, and accepting one creates the obligation with amount, due date and repayment schedule.
3. An open obligation shows amount, due date and counterparty, and a settled Stitch payment closes it on both sides.
4. A confirmed delivery of the funded stock adds it to the retailer's record, and recorded sales show totals.
5. The whole retailer flow, from profile to repaid obligation, runs on the production deployment.

## Boundaries

The small retailer's profile, sourcing, funding request, stock receipt and repayment, extending the bulk order flow of demonstration 1 (epic 8). Not the bulk order flow itself (epic 8), not the ledger and payments (epic 4), not OCR of price lists (epic 6), not routes and proof of delivery (epic 7), and not the proof-bundle export for funders (epic 10).

## References

- parent — ../initiative-ocn.md, section Epics
- spec — ../spec-ocn/spec-ocn.md, section Requirements Inventory (FR18, FR19, FR20)
- constraint — ../architecture-ocn/architecture-ocn.md, section 5.2 (small retailer: stock, funding, obligations), AD-3 (the OCN Node is the only writer to Stitch and the ledger), AD-5 (DuckDB-WASM runs in the web console) and AD-8 (every ledger posting mirrored as a shared-record event)

## Notes

- Tracer: 9.1 (retailer profile and verifiable business identity) is the thinnest path: one signed profile that one supplier circle can invite the retailer into.
- Waits on epic 4 because: pay-ins, the ledger's chart of accounts and payment confirmation (4.2, 4.3, 4.5) back the funding offers, the receivable and payable accounts and the repayment.
- Waits on epic 6 because: OCR'd supplier price lists (6.2) supply the price history retailers search.
- Waits on epic 7 because: a confirmed delivery (7.6) is what adds the stock to the retailer's record.
- Waits on epic 8 because: the retailer's stock order extends the bulk order flow, pinned at its propose step (8.2, through 9.3).
- Assumption: entry 9.5 claims no requirement id; it is the retailer side of FR16, which epics 7 and 8 own, and it adds stock on a confirmed delivery.
- Open question: epic 9 does not list epic 2 at top level, but the signed DID profile (9.1) and invitations need identity from it; epic 8 waits on epic 2, so the order holds, but the user decides whether to add the wait directly.
- Open question: entry 9.3 may attach the retailer's verifiable record (story 10.5 in its plan), which epic 10 owns; epic 9 does not wait on epic 10, and it is left out because attaching is optional.
- Open question: no Refactor sweep story is planned (the standard asks for one when an epic has more than three entries); the user decides whether to add it.
