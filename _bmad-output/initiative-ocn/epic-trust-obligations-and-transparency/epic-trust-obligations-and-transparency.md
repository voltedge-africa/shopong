---
type: epic
title: "Trust, obligations and transparency"
parent: initiative-ocn
covers: [FR20, FR21, FR22, AR5]
assignee: ""
risk: high
---

# Trust, obligations and transparency

## Description

Every transaction has a timeline anyone entitled can inspect, obligations are derived from events, discrepancies are flagged, and participants can prove their record.

## Outcome

For members, treasurers and funders, every transaction can be inspected, discrepancies are flagged and a record can be proven without relying on memory, so trust rests on the shared record.

## Requirements

- FR20: Obligations (who owes whom what by when) are derived from events and tracked until settled.
- FR21: Every transaction has a transparent timeline across the record, the ledger and any on-chain proof, with discrepancies flagged.
- FR22: A participant can export a verifiable track record (a proof bundle) for a funder or supplier.
- AR5: The OCN Node is the only writer to Ledfra, Stitch and the stablecoin adapter (AD-3); the event id is the idempotency and reconciliation key (AD-4).

## Done when

1. A member opens any payment and sees its request, confirmation, ledger posting and any transaction link, in order and joined by event id.
2. A total or status mismatch between the record, the ledger and the payment processor appears as a discrepancy with both values and the event id, and stays visible to approvers until resolved with a recorded reason.
3. A permitted member or funder exports an audit bundle that a stand-alone verifier checks without the app.
4. A participant builds a proof bundle from closed obligations and confirmed deliveries, and the verifier marks which parts are verified and which are the participant's own claims.
5. Rebuilding obligations from the same events gives the same obligations, each with its state.

## Boundaries

The transparency side of the record: timelines, obligations, reconciliation, audit export and proof bundles. Not the ledger postings and payment calls themselves (epic 4, Pooled money), not on-chain stablecoin writes (epic 5, Stablecoin rail), not the operator monitoring of replication and reconciliation status (epic 12, Operations, privacy and sovereignty hardening).

## References

- parent — ../initiative-ocn.md
- spec — ../spec-ocn/spec-ocn.md, Functional Requirements FR20 to FR22; the acceptance criteria of each story are in its plan file in this folder
- constraint — ../architecture-ocn/architecture-ocn.md, AD-4 (the event id is the reconciliation key across record, ledger, payments and chain) and section 7 (POPIA: the record carries commitments, not phone or ID numbers)

## Notes

- Tracer: entry 1, obligations derived from events, is the thinnest path through the shared record view; the timeline, reconciliation and export build on it and on the record's event ids.
- Waits on epic 3 because: the shared record that obligations are derived from, and that timelines, reconciliation and exports read (3.2).
- Waits on epic 4 because: the ledger postings and payment events that the timeline and reconciliation compare against (4.2, 4.5).
- Open question: no Refactor sweep story is planned (the standard asks for one when an epic has more than three entries); the user decides whether to add it.
- Open question: entry 1 derives obligations from pledge.created, funding.accepted and delivery.confirmed, which epics 4, 9 and 7 produce; those epics are not in this epic's after, so the entry waits only on 3.2 until the user says whether to declare them.
- Open question: entry 5 needs confirmed deliveries from epic 7 (logistics) and the optional on-chain link in entry 2 needs epic 5 (stablecoin rail); neither epic is in this epic's after, so neither is pinned until the user decides.
