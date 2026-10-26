---
title: "OCN / Shopong: Architecture and Technology Integration Plan"
status: draft
created: 2026-10-24
inputs:
  - _bmad-output/initiative-ocn/brief-ocn/brief-ocn.md
  - _bmad-output/initiative-ocn/spec-ocn/technology-register.md
  - docs/source/technology-stack-diagram.png
  - docs/source/ocn-shopong-project-spine.pdf
  - docs/source/technology-links.docx
---

# OCN / Shopong: Architecture and Technology Integration Plan

> **Revision (2026-10-24, second pass).** After reading the Pears building-block pages (Hypercore, Corestore, Hyperdrive, HyperDHT, Autobee, Bare Kit, Bluetooth) and OpenCode's server, SDK, permissions, providers, MCP and custom-tool docs, the Data and Intelligence sections below were rewritten. Material changes: writer keys can be restored from one seed (Corestore `primaryKey`); `base.replicate` replaces `store.replicate`; native addons must be linked in the app; iOS suspends worklets after about 30 s; OpenCode has the permission model and authenticated HTTP server that Pi lacks, so the agent runtime is now a spike-gated choice that leans OpenCode, with capability tools exposed through our own MCP server (AD-10, AD-17).
>
> **How to read this.** Section 1-3 give the shape. Section 4 goes capability by capability and, for every technology in the stack diagram, states **what it is (verified), what we use, how we use it, and what for**. Section 5 walks three end-to-end flows. Sections 6-9 cover data, security, deployment and decisions. Section 10 lists risks and the spike that retires each one. Facts about each technology were checked against its documentation on 2026-10-24 (see `technology-register.md`); anything the docs did not state is marked **[unverified]** and owned by a spike story in the epic folders in `_bmad-output/initiative-ocn/`.

## 1. Purpose and principles

OCN provides open, modular infrastructure; Shopong is one access point. The architecture is judged against the project spine:

| Spine principle | Architectural consequence |
|---|---|
| Digital sovereignty | Keys live on people's devices; community records replicate peer-to-peer and survive any single server; every third-party service sits behind a replaceable port. |
| Open, modular infrastructure | Four capabilities (plus a builder layer) expose typed **ports**; adapters wrap each technology; nothing in a capability assumes one workflow. |
| Social economic coordination | Roles (member, treasurer, supplier, driver, funder, builder) are delegated capabilities, not accounts in a central table. |
| Trust and accountability | An append-only shared record, a double-entry ledger and on-chain proofs are cross-checked; obligations are derived from events. |
| Stronger microeconomies | Pooled purchasing, supplier comparison, routed delivery and funding offers are first-class flows. |

## 2. The stack at a glance

The diagram arranges five layers and three support groups. Red arrows give the dependency direction: **Identity authorises Data; Data and Finance exchange records; Finance triggers Logistics; Logistics feeds Intelligence.** Purple dashed arrows tie Data and Intelligence to the Hyper* storage/replication substrate.

```
                 ┌────────────────────────── INTELLIGENCE ──────────────────────────┐
                 │  LLMs ──► Opencode / Pi (agent runtime)                           │
                 │    ▲                                                              │
                 │  Gen UI ─► OpenUI (generated interfaces)                          │
                 └───────────────────────────────▲──────────────────────────────────┘
                                                 │ delivery + route data
   ┌──────────────── LOGISTICS ───────────────────┴──────────────────┐
   │  GIS ──► Kepler.gl (map)   Route planning ──► Valhalla-WASM     │
   │   └────► DuckDB-WASM (spatial SQL)                              │
   └───────────────────────────────▲─────────────────────────────────┘
                                   │ paid orders trigger fulfilment
   ┌──────────────── FINANCE ──────┴─────────────────────────────────┐
   │  Stablecoin ──► ZARP / ZARsc        Payment processor ──► Stitch │
   └───────────────────────────────▲──────────────┬──────────────────┘
                                   │  records     │ postings
   ┌──────────────── DATA ─────────┴──────────────▼──────────────────┐   Hyperbee + Hyperdrive  (storage)
   │  DE Ledger ──► Ledfra                                            │◄─ Hyperswarm + HyperDHT  (replication
   │  System 1 Decision Model ──► Laya                                │      and discovery)
   │  OCR ──► Unlimited OCR                                           │
   └───────────────────────────────▲─────────────────────────────────┘
                                   │ who may do what
   ┌──────────────── IDENTITY ─────┴─────────────────────────────────┐
   │  UCAN ──► ts-ucan                SHA-512 ──► expo-crypto         │
   └──────────────────────────────────────────────────────────────────┘
```

The full diagram is at `docs/source/technology-stack-diagram.png`.

## 3. System shape

### 3.1 Four runtime places

| Place | What runs | Technologies |
|---|---|---|
| **Shopong client** (Expo universal app: iOS, Android, web) | UI, local keys, the member's replica of each community's record, offline writes | Expo, `expo-crypto`, ts-ucan, a **Bare worklet** (`react-native-bare-kit`) running Corestore + Autobase + Hyperbee + Hyperdrive + Hyperswarm, OpenUI `Renderer` |
| **Shopong web console** (browser) | Heavy views that need WASM: spatial SQL, maps, in-browser routing | DuckDB-WASM, Kepler.gl, Valhalla-WASM, OpenUI `Renderer` |
| **OCN Node** (always-on service, one or more, self-hostable) | Seeds and indexes every community's record, ack-converges Autobase, receives payment webhooks, verifies capabilities for external callers, holds service secrets, hosts the ports for hosted services | Node/Bare daemon: Corestore, Autobase, Hyperswarm (with relay), UCAN verifier, Ledfra and Stitch adapters, ZARP/ZARsc adapter, agent runtime (OpenCode server or Pi) in a sandbox plus the OCN Capability MCP server, tile host for Valhalla |
| **Compute services** (GPU/CPU boxes, optional) | OCR and decision inference | vLLM serving Unlimited-OCR (NVIDIA GPU), `laya-serve` (Python), optionally a local LLM endpoint |

### 3.2 Ports and adapters

Each capability is defined by a **port** (a typed interface plus a contract test suite). Every third-party technology is an **adapter** behind a port, so it can be swapped or faked. This is how the "open, modular" principle becomes code, and how we de-risk the four technologies with open questions (ts-ucan vintage, hosted Ledfra, the stablecoin choice, Pi vs OpenCode).

| Port | Adapter(s) |
|---|---|
| `CapabilityAuth` | ts-ucan (default); `iso-ucan` (fallback candidate) |
| `SharedRecord` | Autobase + Hyperbee/Hyperdrive over Hyperswarm |
| `Ledger` | Ledfra (default); in-memory (tests) |
| `PayIn` / `PayOut` | Stitch (default); in-memory (tests) |
| `StableRail` | ZARP or ZARsc adapter (decision D-1) |
| `Ocr` | Unlimited-OCR via vLLM |
| `Decide` | Laya via `laya-serve` |
| `Routing` | Valhalla (browser worker or Node) |
| `Geo` | DuckDB-WASM (+ Kepler.gl for display) |
| `Agent` | OpenCode server mode (leading) or Pi; both reach capabilities only through the OCN Capability MCP server (AD-17) |
| `GenUi` | OpenUI |

### 3.3 One event, many systems

A single user action produces one **signed event** in the shared record, and the other systems follow it. The pattern, used everywhere:

1. The member's device builds an event `{type, v, actor, proof, payload, nonce}` and signs it; `proof` is the UCAN chain that authorises it.
2. It is appended to the community's Autobase (offline is fine).
3. The deterministic `apply` function validates the proof and updates the Hyperbee view.
4. The OCN Node, watching the view, performs the external side effect (post to Ledfra, call Stitch, call the stablecoin adapter) with an idempotency key derived from the event id, then appends a **result event** (`payment.completed`, `ledger.posted`).
5. Every client sees the result when it replicates. The ledger, the record and any on-chain transaction can be reconciled by event id.

## 4. Capability by capability

### 4.1 Identity: who may do what

**Purpose.** Participants hold their own keys, prove who they are to a community, and receive **delegated, attenuated authority** (treasurer, driver, funder, builder agent) without any central account table.

#### UCAN via ts-ucan

| | |
|---|---|
| **What it is (verified)** | UCAN = JWT-based, self-contained capability tokens identified by DIDs, verifiable offline. Package `@ucans/ucans` 0.12.0, Apache-2.0, UCAN spec 0.8.1. Last published July 2023 (see risk R-2). |
| **What we use** | `EdKeypair.create`, `build` (with `proofs` for delegation), `encode`, `verify` with `requiredCapabilities` and our own `isRevoked`; `canDelegateResource` / `canDelegateAbility` for attenuation rules; `did:key` identities. |
| **How** | Each participant has one `did:key` identity (Ed25519) stored in secure storage on the device. A community's **root issuer** is its creator's DID. Capabilities are `{ with: ocn:space/<spaceKey>[/<path>], can: ocn/<ability> }`, with abilities such as `member/invite`, `order/propose`, `order/pledge`, `payment/approve`, `delivery/confirm`, `ledger/read`, `agent/act`. An invitation is a UCAN with `audience = newcomer DID`, short expiry and `member/join`. A treasurer role is a UCAN `payment/approve` with a ceiling fact (`fct: {maxZar: ...}`) that our `canDelegateAbility` rule enforces (attenuation can only lower the ceiling). A builder agent gets a short-lived UCAN narrower than its human owner's. |
| **What for** | Admission to a community; every action's authorisation (checked on the device, in `apply`, and at the OCN Node); delegating to agents; third-party services verify authority without a user database. |
| **Boundaries** | UCAN does not do revocation for us: revocations are events in the shared record and `isRevoked` reads them. UCAN carries no money; ceilings are re-checked against the ledger before a payment executes. Rights amplification is unsupported, so roles must be expressed as plain delegations. |
| **Open** | Expo/Hermes compatibility **[unverified]**; maintenance vintage. Spike 2.1 decides ts-ucan vs `iso-ucan`; the `CapabilityAuth` port isolates the choice. |

#### SHA-512 via expo-crypto

| | |
|---|---|
| **What it is (verified)** | `expo-crypto` 58.0.7: `digestStringAsync`, `digest` (SHA-512 works on iOS, Android and web), `getRandomBytes`, `getRandomValues`, `randomUUID`. **No HMAC, signing or key derivation.** Web needs HTTPS. |
| **What we use** | SHA-512 digests, secure random bytes, UUIDs. |
| **How** | (a) **Content hashes**: every document and photo is referenced in events by `sha512` of its bytes, independent of the Hyperdrive Merkle root, so any party can verify an attachment. (b) **Event fingerprints**: `sha512(canonical JSON of the event)` is stored as the Ledfra transaction metadata and as the Stitch `externalReference`, so the three systems reconcile on one value. (c) **Commitments to personal data**: a phone number or ID number is never written to the shared record; only `HMAC-SHA512(communitySecret, normalised value)` is, which lets members be matched without exposing PII. Because expo-crypto has no HMAC, this uses a small audited library (for example `@noble/hashes`); plain unsalted SHA-512 of a phone number is brute-forceable and must not be used. (d) `getRandomBytes` for nonces and salts; `randomUUID` for idempotency keys. |
| **What for** | Verifiable attachments, cross-system reconciliation, privacy-preserving matching. |
| **Boundaries** | Hashing only. Signing is done by the UCAN keypair (Ed25519), not expo-crypto. 1,024-byte limit per random call. |

### 4.2 Data: shared records, books, documents and fast decisions

**Purpose.** A transparent, replicated record of what the community agreed and did, a ledger of the money, documents turned into data, and fast calibrated decisions on that data. The diagram groups the Hyper* storage, the ledger, the decision model and OCR under Data.

#### Hypercore, Corestore, Hyperbee and Hyperdrive (storage substrate)

| | |
|---|---|
| **What they are (verified)** | **Hypercore** 11.38: a signed (Ed25519) append-only log with a Merkle tree; sparse replication; `clear()` frees local blocks; manifests can name **multiple signers and a quorum** (`signedLength`); optional block encryption; suggested maximum block size 15 MB. **Corestore** 7.x: a factory for named Hypercores on one storage root; `namespace(name)` scopes cores; `replicate(stream)` replicates every core over one stream; `suspend()`/`resume()` for app lifecycle; **`primaryKey`** is a 32-byte master key from which writable cores and key pairs are derived deterministically. **Hyperbee** 2.27: append-only B-tree for sorted key/value data (`put/get/del`, `batch`, `createReadStream`, `sub`, snapshots). **Hyperdrive** 13.3: a filesystem whose **metadata lives in a Hyperbee and file contents in Hyperblobs** (`put/get/del`, `entry`, `list`, `readdir`, `batch`, `checkout`, `diff`, `truncate`, `mirror`, `dedup`, `encryptionKey`, `download(folder)`, `clear(path)`, `monitor`, `watch`). |
| **What we use** | One **Corestore per device/Node** with a `namespace` per community space; Hyperbee as the **materialised view**; Hyperdrive for **files** and **packaged custom solutions**. |
| **How** | Hyperbee key spaces via `sub()`: `members/`, `roles/`, `orders/<orderId>`, `pledges/<orderId>/<did>`, `payments/<eventId>`, `deliveries/<orderId>`, `obligations/<id>`, `docs/<sha512>`, `revocations/<ucanCid>`. Values are JSON with a schema version. Hyperdrive holds supplier price lists, delivery photos, receipts, OCR source images and generated-UI bundles; each file is written with `metadata: { sha512, mime, source }` so the entry itself carries the hash, and the Hyperbee event stores drive key, path and SHA-512. On phones, files sync **lazily** (`download(folder)` only for what a member opens) and old blobs are released with `clear(path)` to protect storage; `dedup` avoids re-storing unchanged files. Large files are streamed, never held whole, and kept under Hypercore's suggested 15 MB block size by the library's chunking. The **Intelligence layer's stored artifacts** (saved custom solutions, prompts, decision logs) live in the same substrate, as the diagram's second purple arrow shows. |
| **Keys and recovery** | Because Corestore derives writable cores and key pairs deterministically from its `primaryKey`, the plan derives that key from the member's identity seed with a proper KDF (decision AD-18). Restoring the seed on a new phone then restores the member's writer cores' keys, so they rejoin as the same writer instead of being re-admitted. Setting `primaryKey` on a root store requires `unsafe: true`; the KDF design is reviewed in story 2.6 and tested in 3.1. |
| **What for** | Offline-first reads on any device, verifiable history, a simple query surface for the UI. |
| **Boundaries** | Hyperbee is not relational; analytics go through DuckDB-WASM (4.4). Key order is by encoded bytes, so keys use sortable encodings. Hyperdrive file-size and memory behaviour is not documented beyond streaming, so large-file limits are tested (story 3.7). `suspend()` no longer flushes the database since Corestore 7.12; flush explicitly on app background. |

#### Autobase (multi-writer) and why not Autobee

| | |
|---|---|
| **What it is (verified)** | Autobase 7.28.2: many writers each append to their own Hypercore; Autobase linearises them into one eventually consistent order; a deterministic `apply(nodes, view, host)` builds the view; writers and indexers are managed through `host.addWriter(key, {isIndexer, weight})` / `host.removeWriter` / `host.ackWriter`. **Autobee** is the same linearisation with the view fixed to a Hyperbee; its page calls it **"experimental and under heavy development, with breaking changes expected,"** and documents no conflict policy beyond "whatever `apply` does with the linearised order." |
| **What we use** | One Autobase **per community space** with a Hyperbee view, written with **our own `apply`**. We do not use Autobee: our state is an event log with derived views and capability validation, not a plain key/value store, and the library is experimental. |
| **How** | Members' devices are writers. **Indexers** are the treasurer devices and the OCN Node(s), giving a quorum for `signedLength` and fast convergence (`base.ack()` from the Node). `apply` is a pure function: it checks the event's UCAN chain against the space's root issuer, applies it to the view, and handles `member.added`/`member.removed` through `host.addWriter`/`host.removeWriter`. `optimistic` writes (default on in Autobee, optional in Autobase) are used for first pledges and **always validated in `apply` before `host.ackWriter`**. `encryptionKey` makes a space private. Replication uses **`base.replicate(conn)`** (not `store.replicate`) so wakeup hints reach idle writers. |
| **What for** | The single transparent record of a community that every member can verify, with no central database. |
| **Boundaries and hard rules** | `apply` must be deterministic: **no wall clock, no network, no randomness**. UCAN expiry is therefore evaluated against a **log time** derived from the log (the highest claimed timestamp accepted so far), not `Date.now()` (AD-6, story 3.6). Side effects (ledger, payments) never run in `apply`; they run in the OCN Node after the view updates. The last indexer cannot be removed. Autobase can reorder already-seen nodes and re-run `apply`, so views are rebuilt-safe by construction. |

#### Hyperswarm and HyperDHT (replication and discovery)

| | |
|---|---|
| **What they are (verified)** | **Hyperswarm** 4.17: peers find each other by a 32-byte topic and open Noise-encrypted connections; `join/leave`, `joinPeer`, `firewall`, `ban`, `maxPeers` 64, `relayThrough`, `suspend/resume/destroy`; one swarm per app. **HyperDHT** 6.34 (the layer under it): connect to a peer by **public key**, UDP hole punching, `createServer`/`connect`, `announce/lookup`, immutable and mutable (signed, sequenced) DHT records, `suspend()`/`resume()`/`destroy()` for mobile, `relayThrough` and relay addresses with `relayKeepAlive` (5 s) and `relayRecoveryWait` (30 s), and a `firewall(remotePublicKey, handshakePayload)` callback. |
| **What we use** | One swarm per client/Node; topic = the space's Autobase `discoveryKey`; direct dial by public key from devices to the OCN Node. |
| **How** | On each connection, `base.replicate(conn)`. The **Node runs a relay** and advertises it through `relayThrough` so devices behind carrier-grade NAT still sync. The Node also runs **our own HyperDHT bootstrap node** (`DHT.bootstrapper(port, host)`) and clients list it in `bootstrap` next to the default public Holepunch bootstrap nodes, so discovery does not depend on third-party infrastructure alone (sovereignty). The swarm `firewall` admits known writers, UCAN read-holders and the Node. The app calls `suspend()` when backgrounded and `resume()` on return. |
| **What for** | Device-to-device sync with no server in the path; resilience when connectivity is poor. |
| **Open** | The HyperDHT page contradicts itself on the `firewall` return value (prose says `false` blocks; the options table says `true` blocks): **verify by test before relying on it**. Default bootstrap addresses are not listed. Throughput and connection-count limits are undocumented. The `bare-bluetooth` option for nearby sync is covered in the next block. |

#### Bare worklet on mobile (react-native-bare-kit) and nearby sync

| | |
|---|---|
| **What it is (verified)** | **Bare Kit** embeds the Bare runtime as isolated **worklets**; `react-native-bare-kit` 0.16.0 wraps it for React Native/Expo. `new Worklet({memoryLimit, assets})`, `start(filename, source, args)`, `suspend([linger])`, `resume()`, `wakeup()`, `update()` (maps app state to suspend/resume), `terminate()`; IPC is `worklet.IPC`, a `streamx` Duplex. The embedded Bare is **1.33.4** (bare-kit 2.5.4/2.5.5). The Pears mobile section lists four guides: embed Bare in a React Native app, **type a native RPC bridge with hyperschema and bare-rpc**, bundle a Bare app, and **handle app suspension**. **`bare-bluetooth`** (+ `-apple`/`-android`) provides BLE GATT and L2CAP channels on iOS, Android, macOS and Linux; its page does not cover Hypercore replication over Bluetooth. |
| **What we use** | One worklet hosting the Corestore/Autobase/Hyperbee/Hyperdrive/Hyperswarm stack; the React Native UI talks to it through a **typed RPC** layer (hyperschema + bare-rpc) over the worklet IPC (`getOrder`, `append`, `subscribe`, `download`). |
| **How** | The worklet is bundled with `bare-pack` (the entry filename must end in `.bundle`) and its **native addons are linked by our app** with `bare-link --preset ios|android` and `bare-pack --linked`, because 0.16.0 removed the library's automatic linking. The worklet registers `Bare.on('uncaughtException')` and forwards errors over IPC (otherwise an uncaught exception aborts the whole host app). `memoryLimit` is set per device class and `optimizeForMemory` is used on iOS. App state changes call `update()`. Known bugs to design around in 0.15.6/0.16.0: `start(filename)` without an args array throws; static `Worklet.wakeup()` throws. |
| **Mobile limits that shape the design** | iOS caps suspend/wakeup time at the background time the OS grants (**about 30 s**), so a phone cannot be relied on to keep syncing in the background: the always-on **OCN Node seeder** (story 3.5) carries that duty. Minimum iOS/Android versions are not stated on the page. |
| **Nearby sync option** | `bare-bluetooth` could let devices in the same room exchange data with no internet. Whether Corestore replication can run over a BLE L2CAP channel is **not documented** and is a separate optional spike (story 3.9). |
| **Open** | Running the whole Hypercore stack, with its native addons, in a worklet inside Expo on a low-end Android device is the **first spike (3.1)**. Fallback: devices talk to the OCN Node over WebSocket and the Node holds the writer cores. |

#### DE Ledger via Ledfra

| | |
|---|---|
| **What it is (verified)** | Hosted double-entry ledger API. Unbalanced writes are rejected (400); entries are immutable; accounts are readable slugs created on first reference; guarded accounts cannot go negative (422); idempotency via `Idempotency-Key`; balances, trial balance, P&L, balance sheet derived on read. |
| **What we use** | The **books** for money: pooled funds, member balances, supplier payables, fees, and later loan/obligation balances. |
| **How** | Chart of accounts per community (slugs, `assets:bank/pool`, `assets:wallet/stable`, `liabilities:member/<did-short>`, `liabilities:supplier/<id>`, `equity:fees`, `assets:receivable/<retailer>`). Every money event maps to **one balanced transaction** with `Idempotency-Key = event id` and metadata `{eventSha512, spaceKey}`. The `member/<did>` accounts are **guarded** so refunds cannot overdraw. Reports are read on demand, not copied. The OCN Node is the only writer (members never call Ledfra). |
| **What for** | Authoritative balances and statements for "pooled funds", per-member contribution and refunds, supplier payables; the financial half of the transparency story. |
| **Boundaries** | Ledfra is hosted: self-hosting, SDKs, tenant isolation, reversal semantics, export and licence are **[unverified]** and it sits in tension with digital sovereignty. Mitigations: the `Ledger` port; every posting is also mirrored as an event in the shared record so the ledger can be **rebuilt** from the record if we leave Ledfra (AD-8); the pricing deadline (workspace created before 2026-12-31 for $99/month Early Access) is a decision driver (D-2). |

#### OCR via Unlimited OCR

| | |
|---|---|
| **What it is (verified)** | Baidu ~3B vision-language document parser (MIT). Images and PDFs (rasterised 300 DPI) in, text with block types and bounding boxes out. Served by vLLM (OpenAI-compatible) or transformers on an NVIDIA GPU; `max_length` 32,768. |
| **What we use** | A **server-side OCR service** behind the `Ocr` port. |
| **How** | A member or supplier uploads a price list, invoice or delivery note into Hyperdrive. The OCN Node queues it, sends page images to the vLLM endpoint with the documented `<image>document parsing.` prompt, keeps the raw output (with `<|det|>` boxes) next to the source, and a parser turns it into rows (`item`, `unit`, `pack size`, `price`). A person **reviews** extracted rows against the page image before they become quotes. |
| **What for** | Turning paper and PDF supplier price lists, invoices and delivery notes into structured data that DuckDB, the comparison view and the decision model can use. |
| **Boundaries** | Needs an NVIDIA GPU (not on-device); output format (Markdown vs structured) must be validated on our documents **[unverified]**; throughput unknown; multi-page uses base mode only. Spike 6.1 sizes the GPU. Low confidence rows are always routed to human review. |

#### System 1 Decision Model via Laya

| | |
|---|---|
| **What it is (verified)** | Multilingual non-autoregressive decision model (~0.4B), Apache-2.0, PyPI `laya` 0.4.14. Input: a state plus typed questions (`choice`, `score`, `noul`). Output: typed answers with calibrated probabilities. `laya-serve` exposes `POST /v1/systemone` (set `LAYA_API_KEY`). 33-40 ms per question on a T4 GPU; CPU 193-464 ms. Weak zero-shot; strong after fine-tune; overconfident until temperature-refit; ordinal `score` and 77-way choices are weak. |
| **What we use** | A fast, **non-generative** classifier for decisions that should not need an LLM. |
| **How** | Question schemas kept small (under ~20 options). Examples: (1) rank supplier options for an order (`choice` over 3-8 quotes with criteria text); (2) is this payment unusual for this community (`noul`)?; (3) which document type is this upload (`choice`)?; (4) is this delivery note consistent with the order (`noul`)?. Answers are gated on `confidence` (not `act_probability`); below the threshold the UI asks a human. Fine-tuned on our own labelled decisions, calibration temperatures refit on our data. All human overrides are logged as training data. |
| **What for** | Instant, explainable-by-probability triage and ranking that works offline-ish and cheaply; it prepares the choice, people make it. |
| **Boundaries** | Never moves money by itself. Serve with auth on a private network (default binds 0.0.0.0 unauthenticated). Use PyPI `laya`, not the unrelated npm `laya`. Set `USE_TF=0`. |

### 4.3 Finance: collect, hold, pay

**Purpose.** Members pay into a pool, the pool pays suppliers, everyone can see where money is, and the books balance.

#### Payment Processor via Stitch

| | |
|---|---|
| **What it is (verified)** | South African payments API (GraphQL). Pay By Bank with Capitec Pay, Absa Pay and PayShap Request; card, DebiCheck, manual EFT; disbursements for payouts. One mutation creates a payment request and returns a hosted redirect URL; webhooks are the source of truth. |
| **What we use** | **Pay-in** to collect member contributions and **pay-out** to settle suppliers. |
| **How** | The OCN Node holds the Stitch client credentials (scope `client_paymentrequest`). When a member pledges, the Node calls `clientPaymentInitiationRequestCreate` with `externalReference = eventSha512`, `payerReference` (max 12 chars), `beneficiaryReference` (max 20), `expireAt`, EFT enabled and card disabled; the app opens the returned URL in **Chrome Custom Tabs / SFSafariViewController** (via `expo-web-browser`), with `redirect_uri` on an allow-listed HTTPS domain. A signed `payment` webhook (Completed/Cancelled/Expired) is verified, de-duplicated by payment id, posted to Ledfra (idempotent), and recorded as a `payment.completed` event. Redirect parameters are used only for UX. A reconciler polls `node(id)` for requests with no webhook after a timeout. Payouts to suppliers use Stitch disbursements after the approval threshold is met. |
| **What for** | Real money in and out of the pool, with a result every member can verify. |
| **Boundaries** | Payment limits (RTP 3,000 to 50,000 ZAR depending on the bank), a 1.00 ZAR minimum, reference length limits. Disbursements, client-credential token details, webhook signature method, settlement times, fees and go-live steps are **[unverified]**; spike 4.4. Use the Stitch test scenarios (`...SimulateComplete`, trigger amounts/references) in CI. |

#### Stablecoin via ZARP / ZARsc

| | |
|---|---|
| **What it is (verified)** | Two ZAR-denominated stablecoins. **ZARP**: contract `0xb755…0C04` on Ethereum, Base, Polygon; Solana mint `dngKh…8rk`; issuer ZARP Stablecoin (Pty) Ltd; **CASP licence pending**. **ZARsc** (Supercoin): Solana Token-2022, 6 decimals, mint `5ekaH…yceQ`; claimed 1:1 Absa reserves, monthly agreed-upon procedures, Fireblocks custody, **no public API**. |
| **What we use** | An **optional second rail** for pooled treasury and cross-community settlement, behind the `StableRail` port. Not on the critical path of the first demonstration. |
| **How** | The pooled treasury of a stokvel may hold some funds as stablecoin so they are programmable (visible on a public chain, payable to a supplier wallet, redeemable to ZAR). Wallet creation, signing and custody are the hard part: options are an exchange account, a custody provider, or self-custody with multi-approval keyed to UCAN roles. The adapter mirrors every movement as `assets:wallet/stable` ledger entries and stores the transaction signature in the event. Start on testnet/devnet and small amounts. |
| **What for** | Transparent, programmable money movement between communities and suppliers; proof of funds on-chain. |
| **Boundaries** | Regulatory and licensing questions, issuer terms, mint/redeem rails, fees and Token-2022 extensions are **[unverified]** and need a decision (D-1) with legal input. We build neither a consumer wallet nor an exchange. |

### 4.4 Logistics: where it is, how it gets there, proof it arrived

**Purpose.** Place members and collection points on a map, plan the route, track the delivery and prove it happened.

#### GIS via Kepler.gl and DuckDB-WASM

| | |
|---|---|
| **What they are (verified)** | **Kepler.gl** (`keplergl/kepler.gl`, MIT): React + Redux component on MapLibre and deck.gl; `@kepler.gl/components`, `@kepler.gl/reducers`, `@kepler.gl/actions`; data via `addDataToMap({datasets:{info,data:{fields,rows}}, options, config})`. The linked `kepler-preview.foursquare.com` returned no readable content, so the open-source package is the working assumption. **DuckDB-WASM** (`@duckdb/duckdb-wasm`, MIT): in-browser SQL on a worker, Arrow results, Parquet range reads, `spatial`/`parquet`/`json` extensions loadable. |
| **What we use** | DuckDB-WASM as the **analytical and spatial query engine** for a community's data; Kepler.gl as the **map and dashboard** surface. |
| **How** | The web console exports the Hyperbee view to Arrow/Parquet (in memory, optionally persisted if OPFS works) and queries it with SQL (`LOAD spatial`): members per suburb, demand per collection point, delivery times, price history per item. Results go to Kepler through `addDataToMap`. Member locations are **coarsened** (for example to a grid cell or suburb centroid) before they ever enter a dataset; exact addresses stay on the member's device. Mobile shows maps from precomputed GeoJSON or a web view; Kepler and DuckDB are web-only. The `Geo` **port** takes a **structured query**, which is safe for agents and generated UIs; raw SQL is used only inside the web console's own DuckDB-WASM code (accepted by the owner). |
| **What for** | Choosing collection points, showing demand and deliveries, price comparisons across suppliers. |
| **Boundaries** | Browser-only; 4 GB WASM ceiling. **Pin the DuckDB-WASM version explicitly**: docs say 1.5.6 stable while npm `latest` is a `1.33.1-dev` build. OPFS and GeoJSON behaviour are **[unverified]**. Kepler format and layer support must be confirmed; Kepler is not React Native, so on the phone it runs only as a built page in a WebView (AD-20). |

#### Route Planning via Valhalla-WASM

| | |
|---|---|
| **What it is (verified)** | `valhalla-browser` 0.2.1 / `valhalla-server` (MIT): the Valhalla engine in WebAssembly in a Web Worker or Node worker thread; `createRouter({manifestUrl})`, `router.route(...)`, costings `auto`, `bicycle`, `pedestrian`, `truck`. **No map data bundled**: you build graph tiles from an OSM `.osm.pbf` and host them (static storage) behind a manifest. One operation at a time; 128/512 MiB browser memory by default; no offline cache; ODbL attribution required. Isochrone, matrix, optimised route and map matching are **not documented**. |
| **What we use** | Single-route planning from a depot or supplier to a collection point (truck/auto), and the driver's route view. |
| **How** | A build pipeline turns a South African (or regional) OSM extract into a versioned tile set and manifest on static hosting; the web console and the OCN Node (`valhalla-server`) both route against it. Multi-stop runs (several collection points) either use repeated single routes with a simple ordering heuristic we write, or wait for a spike showing matrix/optimised-route support (spike 7.1). The driver app shows the route and ETA; routes are stored in the record as a polyline6 string plus the manifest release id so they are reproducible. |
| **What for** | Estimating cost and time of delivery; telling a driver where to go; deciding which collection point is reachable. |
| **Boundaries** | Mobile (iOS/Android) support is **not established**; route on the web console or the Node and send the result to the phone. Needs CSP `'wasm-unsafe-eval'` and `blob:` workers. Tiles are our responsibility (size, update cadence, hosting). |

### 4.5 Intelligence: the builder layer

**Purpose.** "Combined with AI, that data lets anyone build custom solutions." A person describes a workflow; an agent composes the capabilities; a generated interface appears; the person keeps and shares it. The diagram places LLMs at the centre with an agent runtime on one side and a generated-UI runtime on the other.

#### LLMs

| | |
|---|---|
| **What we use** | Provider-agnostic access through OpenCode's `provider` config (`@ai-sdk/openai-compatible`, `baseURL`) or Pi's `pi-ai` layer and `models.json`, with a **local OpenAI-compatible endpoint** (for example vLLM, already needed for OCR) as a sovereignty fallback. |
| **How** | A model-routing policy chooses a hosted or local model per task; prompts carry only data the acting member may see and no raw PII (commitments and names the member has already shared); every call is logged without payloads in the OCN Node. |
| **What for** | Understanding a described workflow, composing tool calls, drafting messages and summaries. |
| **Boundaries** | Cost caps per space; the money-moving tools always require a human confirmation event. Model choice is an open decision (D-7). |

#### Opencode / Pi (agent runtime)

| | **Pi** (`earendil-works/pi`, MIT) | **OpenCode** (`opencode-ai`, `@opencode-ai/sdk` 1.19.4, MIT) |
|---|---|---|
| Shape | In-process TypeScript SDK (`createAgentSession`, `session.prompt`, `session.subscribe`); Node/Bun; also print/JSON/RPC modes | **Server**: `opencode serve` (default `127.0.0.1:4096`, `--cors`), **HTTP API** with sessions, messages, `prompt_async`, SSE `/event`, files, agents; **OpenAPI 3.1 at `/doc`**; JS/TS SDK (`createOpencode`, `createOpencodeClient`, `session.create/prompt`, `event.subscribe`) |
| Auth and isolation | **No built-in permission system**; isolation (Docker, micro-VM, OpenShell) is entirely ours | HTTP basic auth via `OPENCODE_SERVER_PASSWORD`; **permission model** `allow`/`ask`/`deny` per tool with patterns (for example `bash`, `edit`, `webfetch`, `external_directory`), per-agent overrides, and a permission-response endpoint (`/session/:id/permissions/:permissionID`). TLS is not documented. Most built-in tools default to `allow`, so a deny-by-default config is required. |
| Our tools | `customTools` option and `pi.registerTool()` through extensions (plain JSON Schema parameters ran in spike 11.1); **MCP built in from 1.4.0** (stdio and HTTP, `mcp.json`), not in 0.85.1 | **Custom tools** as TypeScript files in `.opencode/tools/` using `tool()` from `@opencode-ai/plugin` with a zod schema and `execute(args, context)`; **MCP servers** (`local` command or `remote` url with headers/OAuth); tools can be disabled by glob (`"servername_*": false`) |
| Models | `@earendil-works/pi-ai`; `models.json` with `baseUrl`, `api`, `apiKey` for OpenAI-compatible endpoints (Ollama, LM Studio, vLLM, SGLang named) | `provider` block with `@ai-sdk/openai-compatible` and `options.baseURL` (Ollama and llama.cpp examples; vLLM is not shown but fits the pattern) |
| Output | Streamed events | **Structured output** via `@opencode-ai/sdk/v2` (`format: json_schema`, `retryCount`) |
| Gaps | Programmatic credential API (`modelRuntime`) undocumented; tool schema not on the SDK page | OpenCode 1 and 2 share the `opencode` command and cannot be installed side by side; permission requests in SDK mode are only named, not detailed; coding-agent tools (bash, edit) must be denied for our use |

| | |
|---|---|
| **What we use** | The agent runtime sits behind the `Agent` port. **Chosen by spike 11.1 (AD-10): OpenCode in server mode, run in a sandbox, talking only to our own MCP server**; Pi stays the alternative behind the same port. The engineering-time agent decision (how we build the code) is separate. Evidence and the gaps still open are in `spec-ocn/technology-register.md`, F-10. |
| **How** | The capability tools (`order.propose`, `quote.compare`, `route.plan`, `ledger.read`, ...) are exposed once, as an **OCN Capability MCP server** that enforces UCAN on every call (AD-17). The agent runtime is configured with `permission: { "*": "deny" }` plus allow-rules for only that server's tools, `OPENCODE_SERVER_PASSWORD` set, bound to localhost or a private socket, no other network. Each session is issued a **short-lived UCAN strictly narrower than the requesting member's**, so a prompt-injected agent cannot exceed what the member could do. Money tools return `needs-confirmation`, which the member must approve in the UI before the Node executes. Sessions are in-memory; the action trail is appended to the shared record. |
| **What for** | The builder who describes a workflow in plain language and gets it composed over Identity, Data, Finance and Logistics. |
| **Boundaries** | Both are coding agents by origin; we use them as workflow composers with a minimal tool set. Sandbox, network egress rules and TLS are our job. Because the MCP server owns the capability surface, switching runtime later is a configuration change, not a rewrite. |

#### Gen UI via OpenUI

| | |
|---|---|
| **What it is (verified)** | OpenUI: a compact **OpenUI Lang** the model emits, rendered progressively by a `Renderer` from a **component library** we define (`createLibrary({root, components})`); `generateSystemPrompt` from `@openuidev/lang-core` builds the model prompt from the library; `onAction` reports user interactions. Packages `@openuidev/react-lang` 1.0.1, `@openuidev/cli` (`generate --spec`). A hosted Gateway/Autofix is optional. React Native is a listed integration. |
| **What we use** | The **renderer and the component library** in Shopong; local prompt generation; no hosted gateway by default. |
| **How** | We define an **OCN component library** (Stack, Metric, Table, Form, Timeline, Map, Chart, ActionButton, MemberList, QuoteCompare, PledgeProgress). Each component is bound to a capability read or action, never to arbitrary code. The agent's reply is OpenUI Lang streamed to the client and rendered live. `onAction` calls the capability API with the member's UCAN, and money actions pass through the confirmation step. A saved solution is the OpenUI source plus its tool bindings, stored in Hyperdrive and shareable by a UCAN to other members. |
| **What for** | "Anyone can build": custom screens for a stokvel's rotating payouts, a retailer's reorder list, a driver's run sheet. |
| **Boundaries** | The `onAction` shape and a security model are not documented **[unverified]**; our component library is the allow-list and we treat generated output as untrusted. The hosted Gateway/Autofix are a sovereignty trade-off (D-5). |

## 5. End-to-end flows

### 5.1 Stokvel bulk order (first demonstration)

```
Treasurer         Member devices             OCN Node                       Outside
   │ propose order     │                         │                              │
   ├──append event────►│ Autobase (offline ok)   │                              │
   │                   │◄──replicate────────────►│ seeds, ack, indexes          │
   │ upload price list ───────────Hyperdrive────►│ queue OCR ──────────────────►│ vLLM Unlimited-OCR
   │                   │                         │◄── rows ────────────────────┤
   │ review rows ──────┤                         │ Laya: rank quotes ──────────►│ laya-serve
   │ choose supplier ──┤ (capability: order/approve)                            │
   │ member pledges ───┤ event pledge.created    │ Stitch create payment ──────►│ Stitch
   │ pays in bank app ◄──────────────────────────┼─ redirect URL ───────────────┤
   │                   │                         │◄─ webhook payment.completed ─┤
   │                   │                         │ Ledfra post (idempotent) ───►│ Ledfra
   │                   │◄── payment.completed event (replicates to all)         │
   │ pool target met ──┤ treasurer + N approve payment/approve                  │
   │                   │                         │ Stitch disbursement ────────►│ supplier
   │ plan delivery ────┤                         │ Valhalla route ──► collection point
   │ driver confirms ──┤ delivery/confirm (geo + photo -> Hyperdrive, SHA-512)  │
   │ members collect ──┤ event collection.confirmed ─► obligations closed       │
```

### 5.2 Small retailer: stock, funding, obligations

1. The retailer's DID joins a *supplier circle* space by invitation (UCAN `member/join`).
2. Suppliers publish offers (price lists via OCR; stock updates as events); the retailer compares them (Laya `choice`, DuckDB price history).
3. The retailer requests funding: a `funding.requested` event with the order and amount; funders (holding a `funding/offer` capability) respond with offers; acceptance creates an **obligation** (`obligation.created`: who owes whom, how much, due when) and Ledfra receivable/payable accounts.
4. Stock is delivered (same logistics flow), sales are recorded as events, repayments (Stitch pay-in or stablecoin) close obligations.
5. The retailer's verifiable track record is the set of closed obligations and deliveries, signed by counterparties (UCAN-bound), exportable as a proof bundle to a funder.

### 5.3 Builder: a person describes a workflow

1. A member types or speaks: "Show me who still owes this month and let me remind them."
2. The OCN Node starts an agent session (OpenCode server or Pi) in the sandbox with a UCAN narrower than the member's, reaching only the OCN Capability MCP server's tools.
3. The agent calls `members.list`, `pledges.query`, composes OpenUI Lang using the OCN component library, and streams it to the client's `Renderer`.
4. The "Remind" button's `onAction` calls `message.send` (a capability) with the member's authority; it does not touch money.
5. The member saves the solution; it is stored in Hyperdrive and can be shared to the space with a UCAN, so a second stokvel can reuse it.

## 6. Data and identifiers

| Thing | Identifier | Where it lives |
|---|---|---|
| Participant | `did:key` (Ed25519) | Device secure storage; public key in `members/` |
| Space (community) | Autobase `key` / `discoveryKey` | Corestore on every member device and the Node |
| Event | `sha512(canonical JSON)` (hex) | Shared record; Ledfra metadata; Stitch `externalReference`; chain tx memo |
| Capability | UCAN CID | Carried in the event; revocations under `revocations/` |
| Document | `sha512(bytes)` + Hyperdrive key/path | Hyperdrive; referenced in `docs/` |
| Money | Ledfra transaction id; Stitch payment id; stablecoin tx signature | Cross-referenced from the event |
| Personal data | `HMAC-SHA512(communitySecret, value)` | Shared record holds only the commitment |
| Route | polyline6 + tile manifest release id | Stored with the delivery event |

**Event envelope (versioned):** `{ v, type, space, actor (did), proof (UCAN chain), claimedAt, nonce, payload }`. Types in the first release: `member.invited/joined/removed`, `role.granted/revoked`, `order.proposed/approved/closed`, `quote.added/selected`, `pledge.created`, `payment.requested/completed/failed/refunded`, `ledger.posted`, `delivery.planned/started/confirmed`, `collection.confirmed`, `funding.requested/offered/accepted`, `obligation.created/settled`, `solution.saved/shared`, `agent.action`.

## 7. Security, privacy and sovereignty

- **Keys.** Ed25519 identity key in OS secure storage (Expo secure storage). One recovery phrase derives the identity seed, from which the Corestore `primaryKey` (writer keys) is derived with a KDF (AD-18), plus optional social recovery by two trustees (a delegation, not a server). Key loss and device loss are covered by stories 2.6 and 12.2.
- **Authorisation in depth.** A UCAN chain is checked on the device (UX), in `apply` (consensus) and at the OCN Node (before any external effect). Revocation is a record event that `isRevoked` reads.
- **POPIA.** Personal information is minimised: the shared record carries commitments, not phone/ID numbers; exact addresses stay on devices; the Ledfra metadata carries only event hashes and opaque ids. A data-protection review is story 12.3. Replicated append-only logs cannot be edited, so what is written to them must be chosen first.
- **Webhooks and secrets.** Stitch and Ledfra credentials exist only on the OCN Node; webhook signatures are verified and replays rejected; secrets in environment/secret store, never in the shared record.
- **Agents.** Sandboxed, no ambient network, narrower UCAN, human confirmation for money, spend limits, prompt-injection tests (story 11.7).
- **Supply chain.** Pin versions (especially DuckDB-WASM), lockfiles, licence and attribution register (OSM ODbL, Valhalla notices, Apache/MIT notices). Story 12.7.
- **CSP.** Web console requires `'wasm-unsafe-eval'` and `blob:` workers for DuckDB and Valhalla; scoped to the console origin only.

## 8. Deployment and environments

| Environment | Purpose | Notes |
|---|---|---|
| Local / CI | Fast tests on in-memory adapters; contract suites; recorded fixtures | Default for every story |
| Sandbox | Stitch test client, Ledfra sandbox ledger, stablecoin testnet/devnet, small OSM extract | Used for demo rehearsal and end-to-end tests |
| Pilot | One or two real stokvels and a handful of retailers | Real Stitch credentials, hosted Ledfra workspace, production tile set |

Self-host kit (story 12.1): `docker compose` for the OCN Node, tile host, `laya-serve`, vLLM + Unlimited-OCR (GPU profile), optional local LLM endpoint, and an operator guide. Costs to plan for: the GPU host (OCR), Ledfra ($99/month Early Access if created before 2026-12-31, then $399/month; 30,000 transactions/month included), LLM usage, tile hosting and bandwidth.

## 9. Decisions

### Made in this plan (revisit with the product owner)

| ID | Decision | Why |
|---|---|---|
| AD-1 | Ports and adapters around every third-party technology | Keeps the platform open and the risky technologies replaceable |
| AD-2 | One Autobase per community space with our own `apply`; Hyperbee view; Hyperdrive for files; **not Autobee** (experimental, key/value only) | Matches the diagram's storage substrate, gives per-community privacy and custom validation |
| AD-3 | The OCN Node is the only writer to Ledfra, Stitch and the stablecoin adapter | Credentials stay off devices; one reconciliation point |
| AD-4 | Event id (SHA-512) is the idempotency and reconciliation key across all systems | Cross-system proof without a shared database |
| AD-5 | Heavy WASM (DuckDB, Kepler, Valhalla) runs in the web console; mobile gets results. **Kepler part superseded by AD-20** | Mobile WASM support is unproven; Kepler is DOM-only |
| AD-6 | `apply` is pure; capability expiry uses log time | Autobase determinism requirement |
| AD-7 | Laya and OCR output are advisory and gated on confidence; people decide | Calibration and accuracy are unproven on our data |
| AD-8 | Every ledger posting is mirrored as a shared-record event so the ledger is rebuildable | Reduces hosted-ledger lock-in |
| AD-9 | PII is stored as keyed commitments, never in the shared record | POPIA and append-only logs |
| AD-10 | **Confirmed 2026-10-26 by spike 11.1: OpenCode server mode is the agent runtime**, run in a sandbox with `permission: { "*": "deny" }`, allow-rules for only the OCN Capability MCP server's tools, and localhost binding. Pi stays the alternative behind the `Agent` port; capability tools sit behind one MCP server either way | Measured with OpenCode 1.19.4 and Pi 0.85.1 and 1.4.0, a local Ollama model (`qwen3.5:9b`) and a stub MCP server. OpenCode denies or asks per tool and removes denied built-ins from the model's tool list; Pi has extension hooks (`tool_call`) but no allow/ask/deny rules. Pi 1.4.0 has native MCP, so MCP is not the deciding factor. Not verified: TLS, the SDK paths, a real UCAN check, a full model run inside the sandbox (see F-10 and shortcuts S-11.1-*) |
| AD-11 | OpenUI renderer + our own component library; local system-prompt generation; no hosted gateway by default | Sovereignty; allow-list for generated UI |
| AD-12 | Stablecoin is an optional rail behind a port, not on the first demo's critical path | Regulatory and API uncertainty |
| AD-13 | Stitch pay-in/pay-out is the fiat rail for the first demo | Documented South African rails and test scenarios |
| AD-14 | Expo universal app with a Bare worklet for P2P; fallback to Node-held writers | Fits the Expo choice implied by expo-crypto |
| AD-15 | Mobile payments open in an in-app browser tab, not a raw WebView | Stitch guidance |
| AD-16 | "Intelligence" is a builder layer over the four capabilities, not a fifth business capability | The PDF names four; the diagram adds Intelligence |
| AD-17 | Capabilities are exposed to agents through one **OCN Capability MCP server** that enforces UCAN on every call | Runtime-agnostic, auditable tool surface |
| AD-18 | A member's Corestore `primaryKey` is derived from their identity seed with a KDF, so one recovery phrase restores identity and writer keys | Corestore derives writable cores deterministically from `primaryKey` |
| AD-19 | Later, not for Demonstration 1: the OCN Node also runs a HyperDHT bootstrap node and a relay. Demonstration 1 has the Node as seeder and only indexer (AD-21), with no relay or bootstrap | Discovery and NAT traversal not solely on third-party infrastructure. Reworded 2026-10-26 (story 3.5, Q5, option A) |
| AD-20 | Supersedes the Kepler.gl part of AD-5 and AGENTS.md rule 7: Kepler.gl ships inside the mobile app as one self-contained built page (`miniapps/vendor/delivery`), shown in a sandboxed WebView by the Delivery mini app. DuckDB-WASM and Valhalla-WASM stay in the web console | Product owner decision, 2026-10-25. The page has no network and no access to the app, and is sent its data by message. Costs: about 22 MB (5.9 MB gzipped) added to the app. The base map is not tiles: it is a bundled OpenStreetMap extract of Clermont, Durban (ODbL, attribution shown on the map) drawn as vector layers, refreshed by script; another area needs its own extract or a tile source |
| AD-21 | For Demonstration 1 the OCN Node holds each community's Autobase and the members' writer keys; phones connect to it over an authenticated connection, save writes offline and sync when online. The on-phone Bare worklet design stays a later spike behind the same `SharedRecord` port. Supersedes the worklet default in AD-14 | Product owner decision, 2026-10-26 (`docs/decisions/3-1-record-on-the-node.md`). The phone test is a multi-day native build and the emulator is not the low-end device the budget needs |
| AD-22 | The ledger is our own, self-hosted on the OCN Node behind the `Ledger` port; Ledfra is no longer the default adapter. Closes D-2. Supersedes the Ledfra default in AD-3 and section 4.2 | Product owner decision, 2026-10-26 (`docs/decisions/d-2-own-ledger.md`). Removes the vendor and the 2026-12-31 deadline; we own accounting correctness |
| AD-23 | For Demonstration 1 supplier quotes are typed by the treasurer and ranked by a plain published rule; the shown confidence is the rule's margin, not a model's. OCR and Laya stay behind the `Ocr` and `Decide` ports for later. Adjusts AD-7 for the first demonstration | Product owner decision, 2026-10-26. OCR needs real documents and a GPU decision, and Laya needs labelled decisions; neither is ready |

### Open: needs the product owner

| ID | Question |
|---|---|
| D-1 | Stablecoin: ZARP, ZARsc, both, or defer? Needs legal input on CASP/FSCA position and custody. |
| D-2 | **Closed 2026-10-26: the ledger is our own, self-hosted (AD-22).** Was: accept a hosted ledger (Ledfra) given the sovereignty principle, or require a self-hostable ledger? |
| D-3 | UCAN library: stay on ts-ucan (spike-gated) or adopt `iso-ucan`? |
| D-4 | Where does GPU compute run (own hardware, rented, community-hosted) for OCR? |
| D-5 | Allow the hosted OpenUI Gateway/Autofix, or local-only generation? |
| D-6 | Target devices and OS floor (the low-end Android baseline drives the Bare worklet and memory budgets). |
| D-7 | Which LLM providers and which local model, and the monthly spend cap. |
| D-8 | Geographic scope for the first tile set and for the pilot communities. |
| D-9 | Agent runtime: **runtime part closed 2026-10-26**, OpenCode server mode confirmed over Pi (AD-10). **Still open:** which sandbox technology the Node uses (bubblewrap with no network was run in spike 11.1; no sandbox was chosen). |

## 10. Risks and the spike that retires each

| ID | Risk | Likelihood / impact | Retired by |
|---|---|---|---|
| R-1 | Hypercore stack and its native addons do not run acceptably in a Bare worklet inside Expo on low-end Android; iOS suspends worklets after about 30 s; Bare Kit 0.16.0 has known bugs | Medium / High | Spike 3.1 (fallback: Node-held writers over WebSocket); the Node seeder carries background sync |
| R-2 | ts-ucan is stale (2023) and may not run on Expo | Medium / High | Spike 2.1 (`CapabilityAuth` port; `iso-ucan` candidate) |
| R-3 | Autobase `apply` nondeterminism (time, revocation) causes divergence | Medium / High | Stories 3.2, 3.6 with property tests on replays |
| R-4 | Hosted Ledfra lacks tenancy/reversal/export or becomes a lock-in | Medium / High | Spike 4.1 and AD-8 |
| R-5 | Stitch disbursement and webhook details are not as assumed | Medium / Medium | Spike 4.4 |
| R-6 | Stablecoin regulatory or API gaps block the rail | High / Medium | Story 5.1 (decision record); rail is optional |
| R-7 | OCR accuracy or GPU cost is poor on real SA documents | Medium / Medium | Spike 6.1 with human review as the default |
| R-8 | Laya zero-shot is below the majority baseline | High / Medium | Spike 6.4 (fine-tune + calibration before any use) |
| R-9 | Valhalla has no mobile support and no matrix/optimised route | High / Medium | Spike 7.1; web/Node routing and our own ordering heuristic |
| R-10 | DuckDB-WASM version confusion; OPFS/spatial gaps | Medium / Low | Spike 3.8 |
| R-11 | Agent prompt-injection moves money or leaks data | Medium / High | Stories 11.3, 11.7 (sandbox, narrow UCAN, confirmation) |
| R-12 | POPIA exposure from append-only logs | Medium / High | Story 12.3, AD-9 |

## 11. Capability to epic map

| Capability / concern | Epics |
|---|---|
| Foundations, ports, walking skeleton | 1 |
| Identity (UCAN, SHA-512) | 2 |
| Data: shared record (Hyper*) | 3 |
| Data: ledger + Finance: Stitch | 4 |
| Finance: stablecoin | 5 |
| Data: OCR + decisions (Laya) | 6 |
| Logistics (DuckDB-WASM, Kepler, Valhalla) | 7 |
| Demonstration 1: stokvel bulk order | 8 |
| Demonstration 2: small retailer | 9 |
| Trust and accountability | 10 |
| Intelligence: builder layer | 11 |
| Operability and sovereignty | 12 |

## 12. Implementation findings (wave 1)

Found by the story agents while building stories 1.1, 1.2, 1.3, 1.5 and 1.6.

- Unlimited-OCR does not document a confidence score, so the real `Ocr` adapter must derive one.
- The `SharedRecord` port identifies writers by DID, while Autobase uses core keys, so the adapter must map between them.
- The record drops repeated event ids. The port contract now requires this.
- Stitch does not document whether `externalReference` is unique, so the Node needs its own idempotency table.
- Ledfra does not document whether a rejected post consumes its idempotency key. The contract does not test it.
- `PayOut` currently takes bank details directly. It may move to a Node-side beneficiary registry after spike 4.4.
- The `Agent` and `GenUi` contracts may need more cases after spike 11.1 and fact F-11.
- Event vectors still need verification under Hermes with the expo-crypto adapter.
- The Stitch webhook payload and signature method are undocumented, so build no signature check on the synthetic fixture.
- The `pnpm-workspace.yaml` `minimumReleaseAgeExclude` list for 17 Expo packages should be removed once those releases age past the cooldown.
