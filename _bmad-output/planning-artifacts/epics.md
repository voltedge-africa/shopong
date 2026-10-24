---
status: draft
stepsCompleted: [requirements-extracted, epics-designed, stories-drafted]
inputDocuments:
  - _bmad-output/planning-artifacts/product-brief-ocn.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/planning-artifacts/technology-register.md
  - docs/source/ocn-shopong-project-spine.pdf
  - docs/source/technology-stack-diagram.png
  - docs/source/technology-links.docx
---

# OCN / Shopong - Epic Breakdown

## Overview

This document decomposes the OCN (Open Commerce Network) and Shopong project into epics and stories that can be determined at this stage. It is derived from the Project Spine, the technology-stack diagram, the technology links, and the architecture plan. It contains **12 epics and 81 stories**. There is no PRD or UX design yet, so requirements below were extracted from the brief and architecture; run `bmad-prd` and `bmad-ux` to confirm them before sprint planning commits to later epics.

Conventions used here:

- **Spike** stories retire a risk named in the architecture. They end in a written go/no-go decision, and downstream stories in the same epic assume the decision is made.
- Stories are ordered so none depends on a later story in the same epic. Cross-epic dependencies are listed in the Epic List.
- Technology facts and their sources are in `technology-register.md`; anything marked **[unverified]** there is owned by a spike.

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

## Epic List

| # | Epic | Needs first | Maturity |
|---|---|---|---|
| 1 | Walking skeleton and capability seams | none | Ready |
| 2 | Identity and delegated authority (UCAN, SHA-512) | 1 | Spike-gated (2.1) |
| 3 | Shared community record (Hyper* stack) | 1, 2 | Spike-gated (3.1) |
| 4 | Pooled money: ledger and payments (Ledfra, Stitch) | 1, 2, 3 | Spike-gated (4.1, 4.4) |
| 5 | Stablecoin rail (ZARP, ZARsc) | 4 | Decision-gated (5.1), optional |
| 6 | Documents and decisions (Unlimited OCR, Laya) | 3 | Spike-gated (6.1, 6.4) |
| 7 | Logistics: map, route, delivery (DuckDB-WASM, Kepler.gl, Valhalla) | 3, 4 | Spike-gated (7.1) |
| 8 | Demonstration 1: stokvel bulk order | 2, 3, 4, 6, 7 | After its inputs |
| 9 | Demonstration 2: small retailer stock and funding | 4, 6, 7, 8 | After demonstration 1 |
| 10 | Trust, obligations and transparency | 3, 4 | Parallel with 8-9 |
| 11 | Builder layer: agents and generated interfaces (Pi/OpenCode, OpenUI, LLMs) | 2, 3, 8 | Spike-gated (11.1) |
| 12 | Operations, privacy and sovereignty hardening | all | Last |

## Epic 1: Walking skeleton and capability seams

A builder can run Shopong on iOS, Android and web against in-memory adapters and watch a scripted stokvel order go from proposal to collection, with every technology behind a port that has a contract test suite. This makes every later epic additive instead of a rewrite.

### Story 1.1: Runnable Shopong app shell and CI

As a builder,
I want a monorepo with an Expo universal Shopong app, an OCN Node service and CI,
So that every later story lands in a tested, runnable shell.

**Acceptance Criteria:**

**Given** a fresh clone  
**When** I run the documented install and start commands  
**Then** the Shopong app opens on iOS simulator, Android emulator and web with a signed-out home screen  
**And** the OCN Node starts and reports healthy on a local port.  

**Given** a pull request  
**When** CI runs  
**Then** lint, type-check and unit tests run for app, node and shared packages  
**And** dependency versions are pinned by lockfile (including `@duckdb/duckdb-wasm`).  

### Story 1.2: Capability ports and the contract test suite

As a builder,
I want typed ports for each capability with a shared contract test suite,
So that any adapter, real or fake, is proven to behave the same way.

**Acceptance Criteria:**

**Given** the ports `CapabilityAuth`, `SharedRecord`, `Ledger`, `PayIn`, `PayOut`, `StableRail`, `Ocr`, `Decide`, `Routing`, `Geo`, `Agent`, `GenUi`  
**When** I read the shared package  
**Then** each port has a documented interface and an in-memory adapter.  

**Given** a port's contract suite  
**When** I run it against the in-memory adapter  
**Then** it passes  
**And** the suite can be pointed at a real adapter later without edits.  

### Story 1.3: Shared event envelope and canonical hashing

As a builder,
I want one versioned event envelope with canonical serialisation and an event id,
So that the record, ledger and payments all reconcile on the same value.

**Acceptance Criteria:**

**Given** an event `{v, type, space, actor, proof, claimedAt, nonce, payload}`  
**When** it is serialised twice on different platforms  
**Then** the canonical bytes and the SHA-512 event id are identical.  

**Given** an event with an unknown `type` or higher `v`  
**When** it is parsed  
**Then** it is preserved and ignored by older readers without error.  

### Story 1.4: Scripted stokvel order on in-memory adapters (tracer)

As a stokvel treasurer,
I want to see a whole bulk order run from proposal to collection in the app,
So that the product shape is real before any external system is connected.

**Acceptance Criteria:**

**Given** the in-memory adapters and a seeded stokvel of five members  
**When** I run the scripted scenario  
**Then** the app shows the order proposed, pledges received, supplier paid, delivery planned and collection confirmed in order  
**And** an automated end-to-end test asserts the same sequence.  

### Story 1.5: OCN Node configuration, secrets and health

As an operator,
I want the OCN Node to load configuration and secrets safely and expose health and metrics,
So that credentials never reach devices and I can see the Node is working.

**Acceptance Criteria:**

**Given** a Node started with a config file and secret environment variables  
**When** a required secret is missing  
**Then** it refuses to start and names the missing key without printing any secret values.  

**Given** a running Node  
**When** I request `/health`  
**Then** it returns component status for the record, ledger, payments and queue.  

### Story 1.6: Sandbox accounts and fixtures

As a builder,
I want sandbox credentials and recorded fixtures for each outside service,
So that tests run without touching real money or data.

**Acceptance Criteria:**

**Given** the sandbox setup guide  
**When** I follow it  
**Then** I have a Stitch test client, a Ledfra sandbox ledger, a Solana devnet and EVM testnet wallet, a small OSM extract and a set of sample supplier documents  
**And** recorded request/response fixtures exist for the first payment and ledger calls.  

## Epic 2: Identity and delegated authority (UCAN, SHA-512)

A person owns their identity on their device, joins communities by invitation, holds roles with limits, and any party can verify who may do what without a central user table. Authority can be revoked, expires and can be recovered.

### Story 2.1: Spike: UCAN library on Expo (ts-ucan vs iso-ucan)

As a builder,
I want to know whether ts-ucan builds, signs and verifies capability chains in an Expo app and what its maintenance risk is,
So that we commit to a library with evidence.

**Acceptance Criteria:**

**Given** an Expo app on iOS, Android and web  
**When** I run `EdKeypair.create`, `build` with proofs, `encode` and `verify` using `@ucans/ucans` 0.12.0  
**Then** I record whether each works on each platform and any polyfills needed.  

**Given** the same scenario using `iso-ucan` 2.0.0  
**When** I compare the two  
**Then** a decision record states the chosen library, the risks (2023 publish date, spec version) and the exit path via the `CapabilityAuth` port.  

### Story 2.2: Create my identity on this device

As a community member,
I want to create an identity that lives only on my phone,
So that I own who I am in the network.

**Acceptance Criteria:**

**Given** a fresh install  
**When** I choose "Create my identity"  
**Then** an Ed25519 keypair and `did:key` are created and the private key is stored in secure storage  
**And** the public DID is shown with a short readable form.  

**Given** the app is reinstalled without a backup  
**When** I open it  
**Then** it does not pretend to know my old identity and offers recovery (story 2.6).  

### Story 2.3: Create a community and join by invitation

As a treasurer,
I want to create a community and invite members with a link or code,
So that only people I invite can join.

**Acceptance Criteria:**

**Given** I created the community  
**When** I invite someone  
**Then** an invitation UCAN is issued for their DID or an open single-use code, with a short expiry and `member/join`.  

**Given** a newcomer presents a valid invitation  
**When** they join  
**Then** the join is verified offline and recorded as a `member.joined` event  
**And** an expired or reused invitation is rejected with a clear reason.  

### Story 2.4: Roles with limits as delegated capabilities

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

### Story 2.5: Verify authority on device, in the record and at the Node

As an operator,
I want every action's authority checked in three places,
So that a forged or stale authorisation cannot cause a real-world effect.

**Acceptance Criteria:**

**Given** an event with a tampered or missing proof  
**When** it is evaluated on the device, in `apply` and at the Node  
**Then** all three refuse it and record why.  

**Given** a valid chain  
**When** evaluated offline  
**Then** it verifies without any network call.  

### Story 2.6: Revocation, key loss and recovery

As a member,
I want to recover my identity and my writer keys if I lose my phone, and the group to cut off a lost key,
So that losing a device is not a disaster or a breach.

**Acceptance Criteria:**

**Given** a recovery phrase from which the identity seed and the Corestore `primaryKey` are derived with a KDF
**When** I restore on a new device
**Then** my DID and my writer cores' keys are recovered, so I rejoin each community as the same writer
**And** the KDF design (including the `unsafe: true` requirement for setting `primaryKey` on a root store) has been reviewed.  

**Given** a lost device that cannot be recovered and two named trustees
**When** the trustees re-delegate my role to a new key
**Then** the old key's authority is revoked by a `role.revoked` event that `isRevoked` honours
**And** the action is refused everywhere from the next sync.

### Story 2.7: SHA-512 content hashes and keyed commitments for personal data

As a member,
I want my phone number and ID never to be written to the shared record,
So that my privacy is protected while the group can still match people.

**Acceptance Criteria:**

**Given** a phone number  
**When** the app needs it in the record  
**Then** only `HMAC-SHA512(communitySecret, normalised value)` is stored  
**And** the HMAC comes from an audited library because expo-crypto has no HMAC.  

**Given** a document or photo  
**When** it is attached  
**Then** its SHA-512 is computed with expo-crypto and stored in the event  
**And** a recipient can re-hash the file and see "verified" or "does not match".  

## Epic 3: Shared community record (Hyper* stack)

Each community has a transparent, replicated record that works offline, converges when devices reconnect, admits writers by capability, and can be queried.

### Story 3.1: Spike: Hypercore stack in a Bare worklet inside Expo

As a builder,
I want to know whether Corestore, Autobase, Hyperbee, Hyperdrive and Hyperswarm run in a `react-native-bare-kit` worklet on low-end Android and iOS,
So that we choose the mobile architecture with evidence.

**Acceptance Criteria:**

**Given** an Expo app with `react-native-bare-kit` 0.16.0, a `bare-pack` bundle and native addons linked with `bare-link`
**When** a worklet opens a Corestore, an Autobase with a Hyperbee view and a Hyperswarm connection to a Node, and the UI calls it through a typed RPC (hyperschema + bare-rpc)
**Then** I record start-up time, memory (with `memoryLimit`), battery over 30 minutes and sync success on the device baseline
**And** I record the effect of the known 0.16.0 bugs (`start(filename)` without args, static `Worklet.wakeup()`) and their workarounds.  

**Given** the app is backgrounded on iOS
**When** the worklet is suspended and resumed with `update()`
**Then** I record what survives within the OS's roughly 30 second allowance and that sync resumes correctly.  

**Given** the results
**When** they fail the budget
**Then** the decision record selects the fallback (Node-held writers over WebSocket) and updates architecture AD-14.

### Story 3.2: Create a community space with a deterministic view

As a treasurer,
I want my community to have its own shared record,
So that everything we do is in one place everyone can verify.

**Acceptance Criteria:**

**Given** a new community  
**When** it is created  
**Then** an Autobase is created with the creator as writer and indexer, a Hyperbee view with the defined key spaces, and a versioned `apply`.  

**Given** a recorded event stream  
**When** replayed on two devices in different orders of arrival  
**Then** both produce byte-identical views (property test)  
**And** `apply` uses no wall clock, network or randomness.  

### Story 3.3: Admit and remove writers by capability

As a treasurer,
I want new members' devices to become writers only with a valid invitation,
So that the record cannot be written by outsiders.

**Acceptance Criteria:**

**Given** a valid `member.joined` event with a UCAN chain  
**When** `apply` runs  
**Then** it calls `host.addWriter` for the member's writer key  
**And** removing a member calls `host.removeWriter` and refuses to remove the last indexer.  

### Story 3.4: Offline writes that converge

As a member in a low-signal area,
I want to record actions offline and have them sync later,
So that bad connectivity does not stop the group.

**Acceptance Criteria:**

**Given** two devices that diverge offline for an hour with different writes  
**When** they reconnect over Hyperswarm  
**Then** both converge to the same view with no lost events  
**And** the UI marks events as "on your phone" until the group has seen them.  

### Story 3.5: Always-on seeder, indexer, relay and bootstrap on the OCN Node

As a member,
I want the record to stay available when my phone is off or in the background,
So that I can catch up from any device.

**Acceptance Criteria:**

**Given** the Node joins a space's swarm topic
**When** members write
**Then** the Node replicates with `base.replicate(conn)`, acks (`base.ack()`) and serves the full record.  

**Given** a device behind carrier-grade NAT
**When** a direct connection fails
**Then** it syncs through the Node's relay (`relayThrough`)
**And** clients list the Node's own HyperDHT bootstrap (`DHT.bootstrapper`) alongside the default public bootstrap nodes.  

**Given** the HyperDHT `firewall` callback
**When** a non-member dials the Node
**Then** a test confirms which return value blocks (the docs contradict themselves) and the Node refuses the stranger.

### Story 3.6: Deterministic capability checks in `apply` using log time

As a builder,
I want expiry and revocation evaluated from the log itself,
So that every peer reaches the same view.

**Acceptance Criteria:**

**Given** a UCAN with an expiry  
**When** `apply` evaluates it  
**Then** it compares against log time (the highest accepted `claimedAt`), not `Date.now()`  
**And** replays on a later date produce the same result.  

**Given** a `role.revoked` event  
**When** a later event uses the revoked capability  
**Then** `apply` rejects the later event and records it as refused.  

### Story 3.7: Files and photos in Hyperdrive with hash references

As a member,
I want to attach price lists, receipts and delivery photos to the record,
So that anyone can verify what was shown.

**Acceptance Criteria:**

**Given** a file added to the community's drive with `metadata: { sha512 }`
**When** its event is written
**Then** the event holds the drive key, path and SHA-512
**And** a receiving device fetches the file lazily with `download(folder)` and verifies the hash.  

**Given** a phone running low on storage
**When** a blob is no longer needed locally
**Then** it is freed with `clear(path)` and re-fetched on demand (`has(path)` shows the state)
**And** large files are streamed and the largest tested size on the device baseline is recorded.

### Story 3.8: Spike and first view: query community data with SQL in the web console

As a community organiser,
I want to explore our data with SQL and charts in the browser,
So that I can answer questions like "who has not paid" without a server.

**Acceptance Criteria:**

**Given** a pinned `@duckdb/duckdb-wasm` version  
**When** the console exports the Hyperbee view to Arrow and runs `LOAD spatial` and a query  
**Then** results render in a table  
**And** a decision record states OPFS persistence, GeoJSON handling and the pinned version.  

### Story 3.9: Spike (optional): nearby sync over Bluetooth

As a member in a place with no data coverage,
I want devices in the same room to exchange community updates directly,
So that a stokvel meeting can work with no internet at all.

**Acceptance Criteria:**

**Given** two phones running a Bare worklet with `bare-bluetooth`
**When** one advertises a GATT service and the other connects and opens an L2CAP channel
**Then** I record whether a Corestore replication stream can run over the channel, its throughput and the permissions required on iOS and Android.  

**Given** the result
**When** replication over BLE is not workable
**Then** the decision record drops it or limits it to exchanging a small "sync hint" and the offline story stays as in 3.4.

## Epic 4: Pooled money: ledger and payments (Ledfra, Stitch)

Members pay into a pool by South African bank payment, the pool is kept in double-entry books everyone can read, and the treasurer pays suppliers once approvals are met, with no double posting.

### Story 4.1: Spike: Ledfra fit (tenancy, reversal, export, self-host)

As a builder,
I want answers to Ledfra's open questions in writing from the vendor and from the sandbox,
So that we decide on a hosted ledger with eyes open.

**Acceptance Criteria:**

**Given** a sandbox workspace  
**When** I test per-community ledgers, guarded accounts, idempotency conflicts, reversals and reports  
**Then** I record behaviour for each and the vendor's written answers on self-hosting, export, licence, rate limits and data residency.  

**Given** the findings  
**When** reviewed with the product owner  
**Then** decision D-2 is recorded (accept hosted with the mirror strategy, or require another ledger) with the 2026-12-31 Early Access deadline considered.  

### Story 4.2: Ledger adapter and chart of accounts

As a treasurer,
I want my community's money recorded in proper books,
So that balances and statements can be trusted.

**Acceptance Criteria:**

**Given** the `Ledger` port and the Ledfra adapter  
**When** the Node posts a transaction for an event  
**Then** it is one balanced transaction with `Idempotency-Key = event id` and metadata `{eventSha512, spaceKey}`  
**And** member accounts are guarded so refunds cannot overdraw.  

**Given** the same event is posted twice  
**When** Ledfra responds  
**Then** no second transaction exists and the Node records the idempotent replay.  

### Story 4.3: Pay my contribution by bank payment

As a member,
I want to pay my share from my own banking app,
So that I do not need cash or a new account.

**Acceptance Criteria:**

**Given** I pledged an amount  
**When** I tap "Pay"  
**Then** the Node creates a Stitch payment request with `externalReference` = event id and the app opens the returned URL in an in-app browser tab  
**And** card is disabled and the redirect domain is allow-listed HTTPS.  

**Given** I complete the payment  
**When** I return to the app  
**Then** it shows "waiting for confirmation" and does not mark the payment paid from redirect parameters alone.  

### Story 4.4: Spike: Stitch disbursements, auth and webhook verification

As a builder,
I want to confirm Stitch's payout API, client-credentials flow, webhook signature method and settlement times,
So that we can design pay-out and reconciliation correctly.

**Acceptance Criteria:**

**Given** the Stitch IDE, Postman collection and docs  
**When** I run the client-credentials flow and a test disbursement  
**Then** I record the endpoints, scopes, limits, signature verification method and settlement times.  

**Given** the findings  
**When** compared with architecture assumptions  
**Then** a decision record lists any change to stories 4.5-4.7.  

### Story 4.5: Payment confirmation by verified webhook, with reconciliation

As a treasurer,
I want payments confirmed only from verified Stitch webhooks, with a safety net,
So that nobody is credited for money that did not arrive.

**Acceptance Criteria:**

**Given** a `PaymentInitiationRequestCompleted` webhook  
**When** the Node verifies its signature and de-duplicates by payment id  
**Then** it posts to the ledger and appends a `payment.completed` event.  

**Given** no webhook arrives before a timeout  
**When** the reconciler polls `node(id)`  
**Then** it resolves the payment's state and records it  
**And** webhook replays and failures are visible to the operator.  

### Story 4.6: Pooled funds and member balances view

As a member,
I want to see how much is in the pool and what I have contributed,
So that I can trust the group's money.

**Acceptance Criteria:**

**Given** payments recorded  
**When** I open the pool  
**Then** I see the pool total, my contribution, each member's status and the target, read from the ledger and matched to the record  
**And** a mismatch is flagged rather than hidden.  

### Story 4.7: Approve and pay a supplier from the pool

As a treasurer,
I want the pool to pay the supplier once enough approvers agree,
So that money moves only with the group's consent.

**Acceptance Criteria:**

**Given** a selected quote and a funded pool  
**When** the required number of `payment/approve` holders approve within their ceilings  
**Then** the Node calls the Stitch payout, records `payment.requested` and later `payment.completed`, and posts a balanced ledger transaction.  

**Given** a missing approval or an exceeded ceiling  
**When** payment is attempted  
**Then** it is refused and the reason is shown.  

### Story 4.8: Refunds, shortfalls and partial funding

As a treasurer,
I want clear handling when the pool falls short or an order is cancelled,
So that no member loses track of their money.

**Acceptance Criteria:**

**Given** an order cancelled before supplier payment  
**When** I choose "refund all"  
**Then** refund events and compensating ledger entries are created per member and each shows its state.  

**Given** a shortfall at the deadline  
**When** I choose to proceed with a smaller order or extend  
**Then** the choice is recorded and members see the effect on their share.  

## Epic 5: Stablecoin rail (ZARP, ZARsc)

The pool can optionally hold and move Rand stablecoin so funds are programmable and provable on-chain. This epic is decision-gated and off the first demonstration's critical path.

### Story 5.1: Decision: ZARP vs ZARsc and custody

As the product owner,
I want a written comparison of ZARP and ZARsc covering regulation, mint/redeem, API access, fees and custody,
So that I can choose one, both or neither.

**Acceptance Criteria:**

**Given** the issuers' documentation and written answers from each issuer  
**When** compared  
**Then** the record covers CASP/FSCA position, entity and licence scope, latest reserve attestation, Token-2022 extensions on the ZARsc mint, contract controls (freeze/blacklist/upgrade) on ZARP, mint/redeem rails, fees and developer access.  

**Given** the comparison  
**When** reviewed with legal input  
**Then** decision D-1 is recorded as proceed, defer or drop, with the custody model.  

### Story 5.2: StableRail port and a testnet adapter

As a builder,
I want a stablecoin adapter proven on testnet behind the port,
So that the rail can be used safely once approved.

**Acceptance Criteria:**

**Given** the chosen token on testnet/devnet  
**When** the adapter creates a wallet, receives and sends test tokens  
**Then** it passes the `StableRail` contract suite  
**And** signing keys never leave the OCN Node or the chosen custody service.  

### Story 5.3: Hold part of the pool as stablecoin, mirrored in the books

As a treasurer,
I want some pooled funds held as stablecoin and shown alongside the rest,
So that members see all funds in one place.

**Acceptance Criteria:**

**Given** a conversion approved by the required approvers  
**When** it executes  
**Then** the transaction signature is stored in the event and a balanced ledger entry moves value between `assets:bank/pool` and `assets:wallet/stable`  
**And** the pool view shows both with the on-chain proof link.  

### Story 5.4: Redeem to Rand and pay a supplier

As a treasurer,
I want to turn stablecoin back into Rand to pay a supplier,
So that the rail ends in money suppliers can use.

**Acceptance Criteria:**

**Given** stablecoin in the treasury  
**When** I redeem through the approved path  
**Then** the redemption is recorded, the ledger is updated, and the supplier payment proceeds through the Stitch payout  
**And** failures leave the funds visible and recoverable.  

## Epic 6: Documents and decisions (Unlimited OCR, Laya)

Supplier paper becomes structured, reviewable quotes, and a fast calibrated model ranks options and flags oddities, always with a person making the final call.

### Story 6.1: Spike: Unlimited-OCR on real documents and GPU sizing

As a builder,
I want to measure accuracy and cost of Unlimited-OCR on real South African supplier documents,
So that we decide the GPU host and the review workflow.

**Acceptance Criteria:**

**Given** at least 30 real price lists, invoices and delivery notes  
**When** parsed through `vllm/vllm-openai:unlimited-ocr`  
**Then** I record field accuracy, pages per minute, VRAM and cost per page  
**And** whether output is Markdown or block-structured with boxes.  

**Given** the results  
**When** reviewed  
**Then** decision D-4 (where GPU compute runs) is recorded.  

### Story 6.2: OCR service behind the Ocr port

As a supplier or member,
I want to upload a price list and have it read automatically,
So that nobody retypes it.

**Acceptance Criteria:**

**Given** an upload in Hyperdrive  
**When** the Node queues it  
**Then** pages are rasterised at 300 DPI, sent to the OCR endpoint, and the raw output with `<|det|>` boxes is stored beside the source  
**And** failures retry with backoff and surface in the operator view.  

### Story 6.3: Structured quotes with human review

As a treasurer,
I want extracted price-list rows checked against the page image before they count,
So that mistakes in OCR do not become wrong orders.

**Acceptance Criteria:**

**Given** extracted rows (`item`, `unit`, `pack size`, `price`)  
**When** I open review  
**Then** each row is shown beside its source region and I can accept, edit or reject it  
**And** accepted rows become `quote.added` events with the source hash.  

### Story 6.4: Spike: Laya calibration and fine-tune on our decisions

As a builder,
I want to learn whether Laya meets our accuracy and calibration bar on our own data,
So that we only use it where it is reliable.

**Acceptance Criteria:**

**Given** a labelled sample of quote-ranking, document-type and consistency decisions  
**When** I compare base, `multilingual` and a fine-tuned checkpoint against the majority-class baseline  
**Then** I record accuracy, expected calibration error after temperature refit and the confidence threshold for each question.  

**Given** the findings  
**When** a question does not beat the baseline  
**Then** it is not shipped and stays a human decision.  

### Story 6.5: Rank supplier quotes with confidence

As a treasurer,
I want ranked supplier options with a stated confidence and the criteria used,
So that I can decide faster without being told what to do.

**Acceptance Criteria:**

**Given** three to eight quotes  
**When** I ask for a ranking  
**Then** Laya answers a `choice` question through `laya-serve` with auth enabled and the UI shows the rank, the confidence and the criteria  
**And** below the confidence threshold it says "no clear recommendation".  

**Given** I override the suggestion  
**When** I choose another supplier  
**Then** the override is logged as a labelled example.  

### Story 6.6: Flag odd payments and mismatched delivery notes

As a treasurer,
I want unusual payments and mismatched delivery notes flagged,
So that problems surface early.

**Acceptance Criteria:**

**Given** a payment request or a delivery note with its order  
**When** the `noul` question is asked (as a two-option `choice` where needed)  
**Then** a flag with confidence is attached when above threshold  
**And** nothing is blocked automatically, only surfaced to the approvers.  

## Epic 7: Logistics: map, route, delivery (DuckDB-WASM, Kepler.gl, Valhalla)

Members see where demand and collection points are, a driver gets a route, and delivery and collection are confirmed with proof.

### Story 7.1: Spike: Valhalla tiles, routing and mobile viability

As a builder,
I want to prove routing against our own tiles and learn what Valhalla-WASM cannot do,
So that logistics design matches reality.

**Acceptance Criteria:**

**Given** an OSM extract for the pilot region  
**When** I build tiles with `pnpm run data:osm` and route with `createRouter` using `auto` and `truck`  
**Then** I record tile size, build time, route latency and memory in browser and Node.  

**Given** Valhalla's documented surface  
**When** I test isochrone, matrix and optimised route  
**Then** I record whether each works  
**And** whether the engine runs on iOS and Android, with the decision recorded.  

### Story 7.2: Tile build pipeline and hosting

As an operator,
I want a reproducible tile build and static hosting with a versioned manifest,
So that routes are consistent and attribution is complete.

**Acceptance Criteria:**

**Given** a pinned OSM extract  
**When** the pipeline runs  
**Then** it outputs tiles, `graph.tar` and a manifest with a release id into static storage  
**And** the app and Node shows OSM (ODbL) attribution.  

### Story 7.3: Map of members, collection points and demand

As a treasurer,
I want to see demand and candidate collection points on a map,
So that I can choose a sensible place to collect.

**Acceptance Criteria:**

**Given** members' locations coarsened to a grid or suburb before leaving their device  
**When** the console loads them into DuckDB-WASM and Kepler.gl via `addDataToMap`  
**Then** I see demand clusters and candidate collection points  
**And** no exact home address is ever in the shared record.  

### Story 7.4: Plan a route to the collection point

As a driver,
I want a route and an estimated time to the collection point,
So that I can plan the delivery.

**Acceptance Criteria:**

**Given** a supplier depot and a collection point  
**When** I request a plan  
**Then** Valhalla returns a `truck` route and the app shows distance, time and the line on a map  
**And** the polyline6 and manifest release id are stored in the `delivery.planned` event.  

### Story 7.5: Multi-stop delivery runs

As a driver,
I want several collection points ordered into one run,
So that one trip serves more than one group.

**Acceptance Criteria:**

**Given** two to eight stops  
**When** I ask for a run  
**Then** the stops are ordered by the approach chosen in spike 7.1 (engine support or our own heuristic) and total time is shown  
**And** the run is stored with its method named.  

### Story 7.6: Proof of delivery and proof of collection

As a treasurer,
I want delivery and collection confirmed with proof,
So that the supplier is released and members know goods arrived.

**Acceptance Criteria:**

**Given** a driver with `delivery/confirm`  
**When** they confirm arrival  
**Then** a signed event with time, coarse location and a photo (SHA-512 in Hyperdrive) is recorded.  

**Given** a member collects their share  
**When** they confirm  
**Then** a `collection.confirmed` event is recorded and the order shows progress.  

### Story 7.7: Follow a delivery and handle exceptions

As a member,
I want to see where my delivery is and what went wrong if it is late,
So that I can plan and complain with evidence.

**Acceptance Criteria:**

**Given** a delivery in progress  
**When** I open it  
**Then** I see status (planned, started, arrived, collected) and the last confirmed point  
**And** a late, failed or partial delivery creates an exception event visible to all approvers.  

## Epic 8: Demonstration 1: stokvel bulk order

A real stokvel completes a bulk grocery purchase using OCN capabilities: propose, compare, pool funds, pay, deliver to a shared collection point and settle, with every step visible to every member.

### Story 8.1: Start a stokvel and invite members

As a stokvel treasurer,
I want to set up our stokvel in Shopong and bring members in,
So that we can start coordinating.

**Acceptance Criteria:**

**Given** I have an identity  
**When** I create the stokvel with a name, rules (contribution, ceiling) and roles  
**Then** members join by invitation and the member list shows who has joined and their roles  
**And** it works offline for the creator and syncs when online.  

### Story 8.2: Propose a bulk grocery order

As a member,
I want to propose a bulk order with a list, a budget and a deadline,
So that the group can decide together.

**Acceptance Criteria:**

**Given** I hold `order/propose`  
**When** I submit a proposal  
**Then** it appears for all members with the budget per member and the deadline  
**And** the treasurer can approve it to open quotes and pledges.  

### Story 8.3: Compare supplier options

As a member,
I want to compare supplier quotes side by side,
So that we choose fairly.

**Acceptance Criteria:**

**Given** reviewed quotes from at least two suppliers  
**When** I open the comparison  
**Then** I see price per item, totals, delivery terms and the ranked suggestion with its confidence  
**And** the treasurer selects a supplier with `quote.selected`.  

### Story 8.4: Pledge and pay, with funding progress

As a member,
I want to commit my share and pay it,
So that the order can go ahead.

**Acceptance Criteria:**

**Given** a selected quote  
**When** I pledge and pay through Stitch  
**Then** my status moves requested to paid and the funding bar updates for everyone  
**And** an unpaid member is shown as such without exposing bank details.  

### Story 8.5: Approve and pay the supplier

As a treasurer,
I want the supplier paid once the pool is funded and approvers agree,
So that the order is placed.

**Acceptance Criteria:**

**Given** a funded pool and the required approvals  
**When** payment executes  
**Then** the supplier is paid, the ledger and the record agree and every member sees "supplier paid".  

### Story 8.6: Arrange delivery to the shared collection point

As a treasurer,
I want delivery planned to our chosen collection point,
So that everyone knows when and where.

**Acceptance Criteria:**

**Given** a paid order and a collection point  
**When** I plan delivery  
**Then** a route, ETA and driver are assigned and members are notified of the window.  

### Story 8.7: Collect and close the order

As a member,
I want to confirm I collected my share and see the order settled,
So that we all know it was done fairly.

**Acceptance Criteria:**

**Given** delivered goods  
**When** each member confirms collection  
**Then** the order closes with a summary of cost per member, any refund or difference, and the full timeline  
**And** open obligations (if any) are created for follow-up.  

## Epic 9: Demonstration 2: small retailer stock and funding

A shop owner finds suppliers and potential funding, gets stock delivered, sells goods and tracks the obligations that follow.

### Story 9.1: Retailer profile and verifiable business identity

As a small retailer,
I want a profile that others can verify,
So that suppliers and funders can trust me.

**Acceptance Criteria:**

**Given** my identity  
**When** I create a business profile  
**Then** it is signed by my DID and shows what I choose to reveal  
**And** a supplier circle can invite me with a capability.  

### Story 9.2: Find suppliers and stock offers

As a retailer,
I want to see suppliers and their current offers,
So that I can restock at the best price.

**Acceptance Criteria:**

**Given** a supplier circle with published offers  
**When** I search by item  
**Then** I see offers, price history (DuckDB) and each supplier's delivery record.  

### Story 9.3: Request funding for a stock order

As a retailer,
I want to ask funders to help pay for stock,
So that I can buy more than my cash allows.

**Acceptance Criteria:**

**Given** a stock order  
**When** I request funding  
**Then** a `funding.requested` event is visible to holders of `funding/offer`  
**And** I can attach my verifiable record (story 10.5) if I choose.  

### Story 9.4: Receive and accept a funding offer

As a retailer,
I want to compare and accept funding offers,
So that terms are clear before I commit.

**Acceptance Criteria:**

**Given** one or more offers  
**When** I accept one  
**Then** a `funding.accepted` event creates an obligation (amount, due date, repayment schedule) and ledger receivable and payable accounts for both parties.  

### Story 9.5: Get stock delivered and record sales

As a retailer,
I want stock delivered and my sales recorded,
So that I can repay and show my track record.

**Acceptance Criteria:**

**Given** a funded order  
**When** delivery is confirmed  
**Then** stock is added to my record  
**And** I can record sales events simply, with totals shown.  

### Story 9.6: Track and repay obligations

As a retailer,
I want to see what I owe and when,
So that I stay in good standing.

**Acceptance Criteria:**

**Given** open obligations  
**When** I open them  
**Then** I see amount, due date and counterparty and can repay by Stitch pay-in  
**And** a settled payment closes the obligation on both sides.  

## Epic 10: Trust, obligations and transparency

Every transaction has a timeline anyone entitled can inspect, obligations are derived from events, discrepancies are flagged, and participants can prove their record.

### Story 10.1: Obligation model derived from events

As a participant,
I want clear obligations (who owes whom what by when),
So that nothing depends on memory.

**Acceptance Criteria:**

**Given** events such as `pledge.created`, `funding.accepted` and `delivery.confirmed`  
**When** the view is built  
**Then** obligations are derived deterministically with state (open, due, overdue, settled)  
**And** the same events always produce the same obligations.  

### Story 10.2: Transparent transaction timeline

As a member,
I want one timeline for each transaction showing record events, ledger postings and any on-chain proof,
So that I can see exactly what happened.

**Acceptance Criteria:**

**Given** a payment  
**When** I open it  
**Then** I see the request, confirmation, ledger posting and (if used) transaction link in order, joined by event id.  

### Story 10.3: Reconciliation and discrepancy flags

As a treasurer,
I want automatic checks that the record, ledger and payment processor agree,
So that problems are caught early.

**Acceptance Criteria:**

**Given** a scheduled reconciliation  
**When** a total or a status differs between systems  
**Then** a discrepancy is created with both values and the event id  
**And** it is visible to approvers until resolved with a recorded reason.  

### Story 10.4: Audit export for members and funders

As a member or funder,
I want an exportable audit of a community or an order,
So that I can check it independently.

**Acceptance Criteria:**

**Given** a permitted request  
**When** I export  
**Then** I receive a bundle of events with their proofs and hashes that a stand-alone verifier can check without the app.  

### Story 10.5: Verifiable track record and proof bundle

As a young entrepreneur or retailer,
I want a proof of my history I can show a funder,
So that I can unlock funding on evidence.

**Acceptance Criteria:**

**Given** closed obligations and confirmed deliveries  
**When** I build a proof bundle  
**Then** it contains the signed events, counterparty confirmations and a summary I choose to share  
**And** the verifier shows which parts are verified and which are my own claims.  

## Epic 11: Builder layer: agents and generated interfaces

A person describes a workflow in plain language; an agent composes it from platform capabilities with narrower authority than the person; a generated interface appears; the person can save, share and fork it.

### Story 11.1: Spike: OpenCode server vs Pi as the agent runtime

As a builder,
I want to compare OpenCode in server mode and Pi for running agent sessions on the OCN Node,
So that we choose one runtime with evidence.

**Acceptance Criteria:**

**Given** a sandbox and a stub capability MCP server
**When** I run a session in OpenCode (`opencode serve` with `OPENCODE_SERVER_PASSWORD`, `permission: {"*": "deny"}` plus allow-rules for the MCP server's tools, `@opencode-ai/sdk`, SSE events, permission requests) and in Pi (`createAgentSession`, `customTools`/`pi.registerTool()`, MCP extension)
**Then** I record how each denies built-in tools, how permission requests surface in SDK mode, how a custom tool or MCP tool is defined, and the effort to sandbox.  

**Given** a local OpenAI-compatible endpoint (for example vLLM)
**When** each runtime is pointed at it (`@ai-sdk/openai-compatible` `baseURL` for OpenCode; `models.json` for Pi)
**Then** I record whether tool calls work and the model-size floor that makes them reliable.  

**Given** the findings
**When** compared
**Then** decision AD-10 (leaning OpenCode) is confirmed or reversed and D-9 is recorded.

### Story 11.2: OCN Capability MCP server with authority checks

As a builder,
I want the platform's capabilities exposed once as an MCP server in which every tool requires a UCAN,
So that any agent runtime can use them and none can exceed the person's authority.

**Acceptance Criteria:**

**Given** the ports
**When** the MCP server is generated
**Then** each tool has a schema, a required ability and a read/write/money classification
**And** a call without the right authority is refused with a reason.  

**Given** a money-classified tool
**When** an agent calls it
**Then** the server returns `needs-confirmation` and performs nothing until the member approves in the UI.

### Story 11.3: Sandboxed agent sessions with narrower authority

As an operator,
I want agent sessions isolated and given less authority than the person,
So that a prompt-injected agent cannot do harm.

**Acceptance Criteria:**

**Given** a request from a member
**When** the Node starts a session
**Then** the agent runtime runs in a sandbox with no network except the Node's capability MCP server and a model endpoint, a deny-by-default permission config, a server password, and a short-lived UCAN strictly narrower than the member's
**And** the session's actions are appended as `agent.action` events.  

**Given** an agent that tries a built-in tool such as `bash` or `edit`
**When** it is called
**Then** the permission config refuses it and the attempt is logged.

### Story 11.4: OCN component library for generated interfaces

As a builder,
I want an approved set of components the model may use,
So that generated screens look native and cannot do arbitrary things.

**Acceptance Criteria:**

**Given** `createLibrary` with Stack, Metric, Table, Form, Timeline, Map, Chart, ActionButton, MemberList, QuoteCompare and PledgeProgress  
**When** I run `generate --spec` and `generateSystemPrompt` locally  
**Then** the spec and prompt are produced without any hosted service  
**And** each component declares which capability read or action it may bind to.  

### Story 11.5: Describe a workflow and get a screen

As a member,
I want to describe what I need and see a working screen,
So that I do not wait for a developer.

**Acceptance Criteria:**

**Given** the prompt "show who still owes this month and let me remind them"  
**When** the agent composes the answer  
**Then** OpenUI Lang streams to the `Renderer` and the screen appears progressively with real data  
**And** an invalid or out-of-library component is dropped with a visible notice.  

### Story 11.6: Actions from generated screens with human confirmation

As a member,
I want buttons in generated screens to act within my authority,
So that custom screens are useful and safe.

**Acceptance Criteria:**

**Given** a generated button bound to a capability  
**When** I press it  
**Then** `onAction` calls the capability API with my UCAN  
**And** any money action shows the confirmation step and cannot run without it.  

### Story 11.7: Safety rails and red-team tests

As an operator,
I want protections and tests against prompt injection and overspend,
So that the builder layer cannot leak data or move money.

**Acceptance Criteria:**

**Given** a test suite of injected instructions in documents, names and messages  
**When** run against the agent  
**Then** none cause an out-of-authority call, a money action without confirmation, or data from another space  
**And** per-space spend and token limits are enforced.  

### Story 11.8: Save, share and fork a custom solution

As a builder,
I want to keep a working solution and let other communities use it,
So that good ideas spread.

**Acceptance Criteria:**

**Given** a working solution  
**When** I save it  
**Then** its OpenUI source and tool bindings are stored in Hyperdrive with a SHA-512  
**And** I can share it with a UCAN to another community, which can fork it under its own authority.  

### Story 11.9: Model routing and local fallback

As an operator,
I want to choose models per task with a local fallback and cost caps,
So that we stay affordable and sovereign.

**Acceptance Criteria:**

**Given** configured providers and a local OpenAI-compatible endpoint  
**When** a hosted provider fails or the cap is hit  
**Then** the Node falls back to the local model or refuses with a clear message  
**And** prompts carry no raw personal data and payloads are not logged.  

## Epic 12: Operations, privacy and sovereignty hardening

A community or organisation can self-host, recover from loss, show it respects privacy law and performs on the devices people have.

### Story 12.1: Self-host kit

As an operator,
I want to run the OCN Node and its services from one compose file with a guide,
So that a community can host its own infrastructure.

**Acceptance Criteria:**

**Given** the kit  
**When** I follow the operator guide on a clean machine  
**Then** the Node, tile host, `laya-serve` and optional GPU services start and pass a smoke test  
**And** secrets are provided out of band, not in the repo.  

### Story 12.2: Backup, restore and recovery drill

As an operator,
I want tested backup and restore for keys, the record and the ledger mapping,
So that losing a device or a server is survivable.

**Acceptance Criteria:**

**Given** a space with history  
**When** I restore the Node on new hardware and a member recovers on a new phone  
**Then** the record, the member's identity and balances match the originals  
**And** the ledger can be rebuilt from mirrored record events and matches Ledfra.  

### Story 12.3: POPIA and data-minimisation review

As the product owner,
I want a review of what personal data is stored where,
So that we meet POPIA and avoid permanent exposure in append-only logs.

**Acceptance Criteria:**

**Given** the data inventory  
**When** reviewed  
**Then** each field is classified (device only, commitment, ledger metadata, shared record) with its lawful basis, retention and deletion approach  
**And** gaps become stories.  

### Story 12.4: Observability

As an operator,
I want dashboards and alerts for replication lag, webhooks, queues and reconciliation,
So that problems are found before members find them.

**Acceptance Criteria:**

**Given** a running Node  
**When** a webhook fails, a queue stalls or replication lags beyond a threshold  
**Then** an alert fires with the space and event id.  

### Story 12.5: Low-end Android performance and data budgets

As a member on an inexpensive phone,
I want the app to be fast and light on data,
So that I can actually use it.

**Acceptance Criteria:**

**Given** the device baseline from decision D-6  
**When** I run the performance suite  
**Then** start-up time, memory, battery and data per flow meet the stated budgets  
**And** a low-data mode defers photos and large files.  

### Story 12.6: Security review and hardening

As the product owner,
I want an independent security review of key handling, webhooks, the sandbox and the web console,
So that real money is safe.

**Acceptance Criteria:**

**Given** the architecture and code  
**When** reviewed  
**Then** findings are triaged with owners  
**And** the CSP for WASM is scoped to the console origin only.  

### Story 12.7: Licences, attribution and supply-chain register

As the product owner,
I want every dependency and data source's licence tracked and shipped,
So that we comply and can answer questions.

**Acceptance Criteria:**

**Given** the dependency set  
**When** the register is generated  
**Then** it lists Apache-2.0 and MIT components, OSM ODbL attribution and Valhalla's compiled-dependency notices  
**And** CI fails when an unregistered licence appears.  
