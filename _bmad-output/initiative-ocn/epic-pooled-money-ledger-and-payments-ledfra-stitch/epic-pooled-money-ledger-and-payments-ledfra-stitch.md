---
type: epic
title: "Pooled money: ledger and payments (Ledfra, Stitch)"
parent: initiative-ocn
covers: [FR9, FR10, FR11, FR12, NFR5, NFR6, AR3, AR5, UX-DR1, AR6, UX-DR2]
assignee: ""
risk: high
---

# Pooled money: ledger and payments (Ledfra, Stitch)

## Description

Members pay into a pool by South African bank payment, the pool is kept in double-entry books everyone can read, and the treasurer pays suppliers once approvals are met, with no double posting.

## Outcome

Members and the treasurer can trust the pool's money because every payment, balance, refund and supplier payout is posted once in balanced books and shown in its real state (waiting, paid, refunded), with the pool total matching the ledger.

## Requirements

- FR9: Members can pledge and pay their contribution through a South African bank payment.
- FR10: Pooled funds, per-member balances and supplier payables are kept in double-entry books and visible to members.
- FR11: The pool can pay a supplier once the required approvals are given.
- FR12: Refunds, shortfalls and partial funding are handled without losing track of money.
- NFR5: Secrets (payment, ledger, LLM keys) exist only on the OCN Node; webhooks are signature-verified and replay-safe; agents run in a sandbox.
- NFR6: Money operations are idempotent end to end: the same event can never post or pay twice.
- AR3: Decisions D-1 to D-8 in the architecture are tracked; spike stories end in a decision record.
- AR5: The OCN Node is the only writer to Ledfra, Stitch and the stablecoin adapter (AD-3); the event id is the idempotency and reconciliation key (AD-4).
- UX-DR1: Plain-language flows a stokvel treasurer can follow without training; money states shown in clear words (requested, paid, failed, refunded).
- AR6: Every ledger posting is mirrored as a shared-record event so the ledger is rebuildable (AD-8).
- UX-DR2: Every money action shows a confirmation step naming the amount, the person and the effect.

## Done when

1. A member pays a pledge from their bank app; the app shows "waiting for confirmation" until the verified webhook arrives, and only then shows the payment as paid.
2. Posting the same event twice, to the ledger or to Stitch, leaves exactly one transaction and one payment.
3. A supplier payment goes through only when enough approvers within their ceilings have approved, and is refused with its reason otherwise.
4. The pool total shown to members equals the ledger balance, and a mismatch with the shared record is flagged.
5. A cancelled order refunds each member with a visible state, and a shortfall choice is recorded and shown to members.
6. Decision D-2 (ledger) and the Stitch decision record exist before the stories that depend on them are built. D-2 is closed (our own ledger): `docs/decisions/d-2-own-ledger.md`; the Stitch record comes from spike 4.4.

## Boundaries

The pool's money: the Ledger adapter, Stitch pay-in and pay-out, the webhook and reconciler, the pool view, and refunds and shortfalls. Not the stablecoin rail (epic 5, which mirrors into this ledger), not the roles and approval ceilings that gate payment (epic 2), not the shared record's writer admission (epic 3), and not the quote comparison that picks a supplier (epic 6).

## References

- parent — ../initiative-ocn.md
- spec — ../spec-ocn/spec-ocn.md, section FR Coverage Map and the FR9 to FR12 lines
- constraint — ../architecture-ocn/architecture-ocn.md, section 4.2 "DE Ledger via Ledfra" (Node is the only writer; one balanced transaction per event keyed by event id; guarded member accounts) and section 4.3 "Payment Processor via Stitch" (webhooks are the source of truth; redirect parameters are for UX only; card disabled); section 9 AD-3, AD-4, AD-8 (every posting mirrored as a record event), AD-15 (payments open in an in-app browser tab)
- stories — the acceptance criteria of each story are in its `*-plan.md` file in this folder

## Notes

- Tracer: entry 1, the Ledfra spike, is the thinnest path: it puts a real sandbox ledger behind one decision before any money moves.
- Waits on epic 1 because: the ports, sandbox fixtures and contract suites (1.2, 1.6), the event envelope the event id comes from (1.3), and the Node secrets that hold the Ledfra and Stitch credentials (1.5).
- Waits on epic 2 because: payment/approve authority and its ceilings (2.4) that entry 7 enforces before any supplier payment.
- Waits on epic 3 because: the shared record that pledges, payments, approvals and refunds are written to (3.2, 3.3).
- Assumption: Stitch does not document whether `externalReference` is unique, so the Node keeps its own idempotency table keyed by event id, owned by entry 2 (the earliest entry that needs it); entry 3 waits on entry 2 for that reason.
- Unknown: Stitch's disbursement API, webhook signature method and settlement times are unverified; entries 5 and 7 wait on spike 4 for them.
- Open question: decision D-2 (accept the hosted Ledfra ledger with a mirror strategy, or require another ledger) is open and sets entries 2, 6 and 8; the 2026-12-31 Early Access price lock is the deadline.
- Open question: entry 7 pays "a selected quote", and quotes belong to epic 6 (structured quotes). Epic 6 is not in this epic's `after`, so no pin is written; the user decides whether to add that dependency.
- Assumption: AR6 (mirror every ledger posting as a shared-record event) is delivered by entry 2, and UX-DR2 (a confirmation step on every money action) by entry 7; placed here because the spec does not map them to an epic.
- Assumption: entry 9, a closing Refactor sweep, was added by default because the epic has more than three entries; declining it is a `Decision:` line.
- Decision: 2026-10-26, the product owner closed D-2: the ledger is our own, self-hosted on the OCN Node, not Ledfra. Entry 4.2 now builds it behind the `Ledger` port and no longer waits on the sandbox step 1.6 (it needs no outside account). The folder and epic names still say Ledfra; they are left as they are so ids and paths do not change.
- Dropped: 2026-10-26, entry 4.1 (Ledfra fit): there is no vendor to test now that D-2 is closed in favour of our own ledger; the Early Access deadline of 2026-12-31 no longer applies.
- Observation (2026-10-26, from the re-cut check, not changed): 4.3 and 4.4 both touch Stitch authentication with no ordering between them; consider making 4.3 wait on the 4.4 spike when 4.3 is planned.
