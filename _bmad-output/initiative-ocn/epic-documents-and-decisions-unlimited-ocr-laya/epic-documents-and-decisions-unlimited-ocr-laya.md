---
type: epic
title: "Documents and decisions (Unlimited OCR, Laya)"
parent: initiative-ocn
covers: [FR5, FR7, FR8, AR1, AR3, NFR7]
assignee: ""
risk: high
---

# Documents and decisions (Unlimited OCR, Laya)

## Description

Supplier paper becomes structured, reviewable quotes, and a fast calibrated model ranks options and flags oddities, always with a person making the final call.

## Outcome

For treasurers and suppliers, price lists, invoices and delivery notes become reviewable structured data and ranked options with a stated confidence, so the treasurer decides faster and nothing counts until a person accepts it.

## Requirements

- FR5: Documents and photos can be attached to the record and verified by their hash.
- FR7: Supplier price lists, invoices and delivery notes can be turned into structured data, with human review.
- FR8: Supplier options can be compared, with ranked suggestions and a stated confidence.
- AR1: Every third-party technology sits behind a port with a contract test suite and an in-memory adapter (architecture AD-1).
- AR3: Decisions D-1 to D-8 in the architecture are tracked; spike stories end in a decision record.
- NFR7: Operators can see replication lag, webhook failures, queue depth and reconciliation status.

## Done when

1. An uploaded supplier price list is read, and each extracted row can be accepted, edited or rejected beside its source before it counts.
2. Accepted rows appear as `quote.added` events that carry the source hash, so the source document can be verified.
3. Three to eight quotes produce a ranking that shows rank, confidence and criteria, and below the threshold it says "no clear recommendation".
4. A treasurer's override of the suggested supplier is stored as a labelled example.
5. Decision D-4 (where GPU compute runs) is recorded, and any Laya question that does not beat the majority-class baseline is left as a human decision.

## Boundaries

Turning supplier paper into reviewable data and advisory ranking, with people deciding. Not the record's file storage and Hyperdrive (epic 3), not the delivery and collection proof (epic 7), and not the payment and approval flows that spend money on a chosen supplier (epic 4).

## References

- parent — ../initiative-ocn.md
- spec — ../spec-ocn/spec-ocn.md, FR5, FR7, FR8 lines and FR Coverage Map
- constraint — ../architecture-ocn/architecture-ocn.md, section 4.2 "OCR via Unlimited OCR" and "System 1 Decision Model via Laya" (OCR and Laya output are advisory and gated on confidence); section 12 (Unlimited-OCR documents no confidence score, so the adapter derives one); section 9 AD-7 (Laya and OCR output advisory, gated on confidence, people decide), D-4
- stories — the acceptance criteria of each story are in its `*-plan.md` file in this folder

## Notes

- Tracer: entry 1, the Unlimited-OCR spike on real documents, is the thinnest path: it measures accuracy and cost, and fixes where the OCR runs, before any service code.
- Waits on epic 3 because: the shared record and Hyperdrive that hold uploads and quote events (3.7).
- Unknown: Unlimited-OCR documents no confidence score, so the adapter must derive one; entries 5 and 6 cannot state a confidence until spike 1 and spike 4 show it is usable.
- Open question: decision D-4 (where GPU compute runs: own hardware, rented, or community-hosted) is open and the user decides it; entry 2 waits on entry 1 for it.
- Open question: entry 6 flags odd payment requests (epic 4) and delivery notes (epic 7), and neither is in this epic's `after`, so no pin is written; the user decides whether to add them. Its odd-payment flags also sit close to FR21 (discrepancy flags, epic 10), which the user should place.
- Assumption: entry 7, a closing Refactor sweep, was added by default because the epic has more than three entries; declining it is a `Decision:` line.
- Decision: 2026-10-26, the product owner chose typed quotes and a simple explainable ranking for Demonstration 1. New entries 6.8 (typed supplier quotes) and 6.9 (rank quotes by a simple rule) feed story 8.3. OCR (6.1 to 6.3) and Laya (6.4, 6.5) stay in the epic for later and no longer gate Demonstration 1; they slot in behind the existing `Ocr` and `Decide` ports. The "confidence" shown is the rule's margin and is not model-derived.
