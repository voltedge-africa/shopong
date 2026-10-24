---
status: draft
inputDocuments:
  - docs/source/ocn-shopong-project-spine.pdf
  - docs/source/technology-stack-diagram.png
  - docs/source/technology-links.docx
---

# OCN / Shopong - Spec

## Overview

This document decomposes the OCN (Open Commerce Network) and Shopong project into epics and stories that can be determined at this stage. It is derived from the Project Spine, the technology-stack diagram, the technology links, and the architecture plan. It contains **12 epics and 81 stories**. There is no PRD or UX design yet, so requirements below were extracted from the brief and architecture; run `bmad-prd` and `bmad-ux` to confirm them before sprint planning commits to later epics.

Conventions used here:

- **Spike** stories retire a risk named in the architecture. They end in a written go/no-go decision, and downstream stories in the same epic assume the decision is made.
- Stories are ordered so none depends on a later story in the same epic. Cross-epic dependencies are the `after` rows in `initiative-ocn/tickets.toml`.
- Technology facts and their sources are in `technology-register.md` (in this folder); anything marked **[unverified]** there is owned by a spike.

## Requirements Inventory

### Functional Requirements

FR1: A person can create a self-sovereign identity on their own device and prove it to others.
FR2: A person can create a community space (for example a stokvel) and invite members into it.
FR3: Authority inside a community is delegated as roles with limits (for example a payment ceiling) and can be revoked or expire.
FR4: A community has a shared, replicated, transparent record of what was agreed and done, usable offline and convergent when reconnected.
FR5: Documents and photos can be attached to the record and verified by their hash.
FR6: A member can propose a bulk order with a budget and a deadline.
FR7: Supplier price lists, invoices and delivery notes can be turned into structured data, with human review.
FR8: Supplier options can be compared, with ranked suggestions and a stated confidence.
FR9: Members can pledge and pay their contribution through a South African bank payment.
FR10: Pooled funds, per-member balances and supplier payables are kept in double-entry books and visible to members.
FR11: The pool can pay a supplier once the required approvals are given.
FR12: Refunds, shortfalls and partial funding are handled without losing track of money.
FR13: Funds can optionally be held and moved as a Rand stablecoin, with on-chain proof attached to the record.
FR14: Collection points and demand can be shown on a map and queried spatially.
FR15: A delivery route to a collection point can be planned, with estimated distance and time.
FR16: Delivery and collection are confirmed with proof (who, where, when, photo) that triggers the next step.
FR17: Members can follow a delivery and see exceptions (late, failed, partial).
FR18: A small retailer can build a verifiable profile and find suppliers and stock offers.
FR19: A retailer can request funding; funders can offer; acceptance creates obligations.
FR20: Obligations (who owes whom what by when) are derived from events and tracked until settled.
FR21: Every transaction has a transparent timeline across the record, the ledger and any on-chain proof, with discrepancies flagged.
FR22: A participant can export a verifiable track record (a proof bundle) for a funder or supplier.
FR23: A person can describe a workflow in plain language and an agent composes it from the platform's capabilities.
FR24: The agent's result is shown as a generated interface built only from an approved component library.
FR25: A custom solution can be saved, shared with a community and forked.
FR26: Agents act only with narrower authority than the person, and money actions require human confirmation.
FR27: A community or organisation can self-host an OCN Node and its services.
FR28: Keys, the record and the ledger mapping can be backed up and recovered after device loss.

### NonFunctional Requirements

NFR1: Core community flows (propose, pledge, view, confirm delivery) work offline and converge without data loss when devices reconnect.
NFR2: The Shopong app meets a memory, battery and data budget on a low-end Android baseline (to be fixed with decision D-6).
NFR3: Personal information is minimised (POPIA): the shared record holds keyed commitments, not phone or ID numbers; exact addresses stay on the device.
NFR4: The shared-record `apply` function is deterministic: no wall clock, no network, no randomness; verified by replay tests.
NFR5: Secrets (payment, ledger, LLM keys) exist only on the OCN Node; webhooks are signature-verified and replay-safe; agents run in a sandbox.
NFR6: Money operations are idempotent end to end: the same event can never post or pay twice.
NFR7: Operators can see replication lag, webhook failures, queue depth and reconciliation status.
NFR8: Third-party licences and attributions (OSM ODbL, Valhalla notices, Apache/MIT) are tracked and shipped.
NFR9: Flows are usable with low data cost and in low-connectivity conditions.

### Additional Requirements

AR1: Every third-party technology sits behind a port with a contract test suite and an in-memory adapter (architecture AD-1).
AR2: Versions are pinned, notably DuckDB-WASM (the docs and the npm `latest` tag disagree).
AR3: Decisions D-1 to D-8 in the architecture are tracked; spike stories end in a decision record.
AR4: The shared record uses one versioned event envelope; one Autobase per community space with a Hyperbee view and Hyperdrive for files (AD-2).
AR5: The OCN Node is the only writer to Ledfra, Stitch and the stablecoin adapter (AD-3); the event id is the idempotency and reconciliation key (AD-4).
AR6: Every ledger posting is mirrored as a shared-record event so the ledger is rebuildable (AD-8).
AR7: Heavy WASM (DuckDB, Kepler.gl, Valhalla) runs in the web console; mobile receives results (AD-5).
AR8: The web console's CSP allows `'wasm-unsafe-eval'` and `blob:` workers on its own origin only.
AR9: A reproducible tile build pipeline (OSM extract to Valhalla tiles and manifest) with versioned releases and ODbL attribution.
AR10: Personal data is stored as `HMAC-SHA512(communitySecret, value)` commitments, with an audited HMAC library because expo-crypto has none.
AR11: The Bare worklet is bundled with `bare-pack`, its native addons are linked by the app with `bare-link`, and the UI talks to it over a typed RPC (hyperschema + bare-rpc); iOS background time is treated as about 30 seconds, so the OCN Node seeder carries background sync.
AR12: A member's Corestore `primaryKey` is derived from their identity seed with a KDF so one recovery phrase restores identity and writer keys (architecture AD-18).
AR13: Agents reach platform capabilities only through one OCN Capability MCP server that enforces UCAN on every call (architecture AD-17).

### UX Design Requirements

No UX design exists yet. The following are provisional and should be confirmed by `bmad-ux`:

UX-DR1: Plain-language flows a stokvel treasurer can follow without training; money states shown in clear words (requested, paid, failed, refunded).
UX-DR2: Every money action shows a confirmation step naming the amount, the person and the effect.
UX-DR3: A low-data mode and clear offline indicators ("saved on your phone, will sync").
UX-DR4: Generated interfaces look and behave like native Shopong screens and cannot reach outside the component library.
UX-DR5: Accessible touch targets, contrast and screen-reader labels; room for more than one South African language.

### FR Coverage Map

| FR | Epic(s) |
|---|---|
| FR1 | 2 |
| FR2 | 2, 3, 8 |
| FR3 | 2 |
| FR4 | 3 |
| FR5 | 3, 6 |
| FR6 | 8 |
| FR7 | 6 |
| FR8 | 6, 8 |
| FR9 | 4, 8 |
| FR10 | 4 |
| FR11 | 4, 8 |
| FR12 | 4 |
| FR13 | 5 |
| FR14 | 7 |
| FR15 | 7 |
| FR16 | 7, 8 |
| FR17 | 7 |
| FR18 | 9 |
| FR19 | 9 |
| FR20 | 9, 10 |
| FR21 | 10 |
| FR22 | 10 |
| FR23 | 11 |
| FR24 | 11 |
| FR25 | 11 |
| FR26 | 11 |
| FR27 | 12 |
| FR28 | 2, 12 |

