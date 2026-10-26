---
title: "OCN / Shopong: Technology Register"
status: draft
created: 2026-10-24
verified: 2026-10-24
---

# Technology Register

One entry per technology in the stack diagram. Facts come from the linked documentation fetched on **2026-10-24**; npm/PyPI versions were read from the registries the same day. Anything the documentation did not state is listed under **Gaps** and is a spike or open question, not an assumption. How each technology is used is in `architecture.md`.

**Second pass (2026-10-24):** the Pears building-block pages (Hypercore, Corestore, Hyperbee, Hyperdrive, Hyperswarm, HyperDHT, Autobase, Autobee), the Bare Kit reference and OpenCode's server, SDK, permissions, providers, MCP and custom-tool pages were read in full; Pi's custom-tool example and the Pears RN embedding guides themselves (only their index was reachable) remain unread.

Legend: **Link** = in `links.docx`. **Diagram only** = in the stack diagram but not in `links.docx`.

## Identity

### UCAN via ts-ucan (Link: github.com/ucan-wg/ts-ucan)
- **What:** UCAN ("User Controlled Authorization Network"): JWT-based, self-contained capability tokens identified by DIDs; verifiable offline. Package `@ucans/ucans` 0.12.0, Apache-2.0, UCAN spec v0.8.1.
- **API (documented):** `EdKeypair.create()`; `ucans.build({issuer, audience, capabilities, lifetimeInSeconds|expiration, notBefore, facts, proofs, addNonce})`; `ucans.encode()`; `ucans.verify(encoded, {audience, isRevoked, requiredCapabilities:[{capability, rootIssuer}]})`. Capability shape `{with:{scheme,hierPart}, can:{namespace,segments}}`. Delegation rules via `canDelegateResource` / `canDelegateAbility`; `capability.superUser.SUPERUSER` wildcard. Bring-your-own-signer path: `buildPayload` then `sign`.
- **Gaps / flags:** last published **2023-07-25** (npm). No deprecation notice and no named successor on the repo page, but the active UCAN 1.0 line is `iso-ucan` 2.0.0 (published 2026-10-01) and `@ucanto/core` 10.4.6 (2025-10-27). Revocation is not built in (`isRevoked` callback is ours to implement). Only `did:key` shown. No dedicated delegate function (delegate by building with `proofs`; inferred). React Native / Expo compatibility **unverified**. Rights amplification unsupported. Chain-walking algorithm not described.

### SHA-512 via expo-crypto (Link: docs.expo.dev/versions/latest/sdk/crypto/)
- **What:** `expo-crypto` 58.0.7 (MIT). `digestStringAsync(algo, data, {encoding})` (hex default, base64 option), `digest(algo, BufferSource) -> ArrayBuffer`, `getRandomBytes/Async(n)` (n 0..1024), `getRandomValues`, `randomUUID`. `CryptoDigestAlgorithm.SHA512` works on all platforms.
- **Gaps / flags:** **no HMAC, signing or key derivation**. Web digest requires a secure origin (HTTPS/localhost) or throws `ERR_CRYPTO_UNAVAILABLE`. Random bytes capped at 1,024 per call. The page's decrypt example has a bug (`data` should be `sealedData`).

## Data

### Hypercore and Corestore (Diagram only; Pears docs read 2026-10-24)
- **Hypercore** 11.39.3 on npm (docs cover 11.38; Apache-2.0): signed append-only log (Ed25519) with a Merkle tree (BLAKE2b). `append`, `get`, `createReadStream`, `session`, `snapshot`, `replicate`, sparse `download`, `clear` (drop local blocks), `truncate` (signed, bumps fork), `proof`/`verifyFullyRemote`, block encryption. **Manifests support multiple signers and a quorum** (`signedLength`). Suggested max block 15 MB (`MAX_SUGGESTED_BLOCK_SIZE`; larger appends throw `BAD_ARGUMENT`). `registerExtension` is legacy (use Protomux).
- **Corestore** 7.16.1 on npm (docs v7.13.0): `new Corestore(path)`, `get({name|key})`, `session()`, `namespace(name)` (same name in different namespaces = different cores), `replicate(stream)`, `suspend()/resume()` (since 7.12.0 `suspend` no longer flushes), `audit()`, `staticify()`. **`store.primaryKey`** is a 32-byte master key; writable named cores and key pairs are derived deterministically from it; supplying one to a root store needs `unsafe: true`.
- **Gaps / flags:** the pages do not mention random-access-file/in-memory backends (storage is `hypercore-storage`); encryption details and **mobile storage behaviour are not described**.

### Hyperbee (Diagram only; Pears docs read)
- 2.27.3 (MIT): append-only B-tree on Hypercore. `put/get/del`, `batch()` + `flush()` (atomic), `createReadStream({gte,lt})`, `peek`, `sub(prefix)` namespaces, `checkout(version)`/`snapshot()`, `cas` option. Keys sort by encoded bytes. Multiwriter form is **Autobee**.
- **Gaps / flags:** the page does not discuss Bare or React Native. `watch()`/`getAndWatch()` throw on subs, checkouts and snapshots. `alwaysDuplicate` default (true) is planned to change.

### Hyperdrive (Diagram only; Pears docs read)
- 13.3.4 (Apache-2.0): **metadata in a Hyperbee, contents in Hyperblobs**, typically one Corestore. `new Hyperdrive(store,[key],[opts])`, `put(path, buffer, {metadata, executable, dedup})`, `get`, `createReadStream/WriteStream`, `entry`, `exists`, `has` (blob stored locally), `del`, `clear(path)` (free blob, keep reference), `clearAll`, `symlink`, `list`, `readdir`, `entries`, `compare`, `watch`, `monitor(name)`. Versioning: `version`, `batch()`/`flush()`, `checkout(version)`, `diff`, `truncate(version)`. Replication: `replicate`, typical Hyperswarm join on `drive.discoveryKey`, `findingPeers`, `update`. Downloads: `download(folder)`, `downloadDiff`, `downloadRange`, `mirror(out)` to another drive or Localdrive. Options: `encryptionKey`, `onwait`, `active`. Errors: `BAD_ARGUMENT`, `BLOCK_NOT_AVAILABLE`.
- **Gaps / flags:** **no documented file-size limit, chunking strategy or memory behaviour**; `compat`/`extension` options undocumented. Test large files on-device.

### Hyperswarm and HyperDHT (Diagram only; Pears docs read)
- **Hyperswarm** 4.17.2 (MIT): peers find each other by a 32-byte topic; `join(topic,{server,client,limit})`, `leave`, `joinPeer`/`leavePeer`, `firewall`, `peerInfo.ban()`, `maxPeers` 64, `maxParallel` 3, `relayThrough`, `listen/suspend/resume/destroy`; Noise-encrypted duplex connections; one swarm per app recommended. `store.replicate(conn)` works for a Corestore.
- **HyperDHT** 6.34.1 (stable): `new DHT()`, `DHT.keyPair(seed)`, `DHT.bootstrapper(port, host)`, `createServer`/`server.listen(keyPair)`, `connect(remotePublicKey,{relayAddresses, relayThrough})`, `announce/unannounce/lookup/findPeer`, `immutablePut/Get`, `mutablePut/Get` (Ed25519-signed, sequenced), `suspend()/resume()/destroy()`, `firewall(remotePublicKey, handshakePayload)`, `relayKeepAlive` 5000 ms, `relayRecoveryWait` 30000 ms, `randomPunchInterval` 20000 ms. Connections are Noise secret-streams (`socket.remotePublicKey`, `handshakeHash`).
- **Gaps / flags:** **the `firewall` return semantics are contradictory on the page** (prose vs options table); default bootstrap node addresses are not listed; no throughput, connection-count or message-size limits; NAT types and hole-punch success rates are not described.

### Autobase (Link: docs.pears.com/.../autobase/)
- **What:** v7.28.2 (Apache-2.0, "stable"). Multi-writer layer over Hypercores: each writer appends to its own local core; Autobase linearises the causal graph into one order; a deterministic `apply(nodes, view, host)` builds the view (usually a Hyperbee). Constructor `new Autobase(store, bootstrap, {open, apply, valueEncoding, optimistic, ackInterval (10000 ms), encryptionKey, fastForward, wakeup, bigBatches})`. `host.addWriter(key,{indexer})`, `host.removeWriter`, `host.removeable`, `host.ackWriter`, `host.interrupt`. `base.append/update/ack/replicate`, `signedLength`, `heads()`, `pause/resume`. Last indexer cannot be removed.
- **Gaps / flags:** the order of already-seen nodes can change; **`apply` must be deterministic** or peers diverge. Runtime support on the page: not stated (the Pears index says modules are "usable from any Bare or Node.js app"). Hyperdrive as a view not covered.

### Autobee (Diagram only; Pears docs read)
- Multiwriter Hyperbee: `new Autobee(store, key, {apply, open, close, update, optimistic, encryptionKey, fastForward})`, `append(value)`, `update()`, `flush()`, `db.view` read API, `moveTo(head)`, `getMostRecentHead()`; writers via `host.addWriter(key,{isIndexer, weight})`, `removeWriter`, `ackWriter`, `interrupt`; optimistic appends on by default; use `db.replicate(conn)` not `store.replicate(conn)`.
- **Gaps / flags:** the page says it is **"experimental and under heavy development, with breaking changes expected"** (pin an exact version); no stated conflict policy beyond linearised order.

### Bare Kit and react-native-bare-kit (Diagram only; Pears and bare-kit docs read)
- `react-native-bare-kit` 0.16.0 (published 2026-10-09). `new Worklet({memoryLimit, assets})` (or `new Worklet(id, options)`), `start(filename, source, args)`, `suspend([linger])`, `resume()`, `wakeup([deadline])`, `update([state])`, `terminate()`; events `suspend`, `wakeup`, `idle`, `resume`; IPC `worklet.IPC` (a `streamx` Duplex on React Native; `BareKit.IPC` inside). Embeds Bare **1.33.4** (bare-kit 2.5.4/2.5.5). Bundle with `bare-pack` (entry must end in `.bundle`); **the app links native addons itself** (`bare-link --preset ios|android`, then `bare-pack --linked`) because 0.16.0 removed automatic linking. `optimizeForMemory` on iOS limits the libuv thread pool. Uncaught worklet exceptions abort the host unless a handler is registered. Background: negative linger/deadline use the 30 s platform default; **on iOS any suspend/wakeup is capped at the background time the OS grants (30 s when unreported)**.
- **Pears mobile guides listed (not read in detail):** embed Bare in React Native; typed native RPC bridge (hyperschema + bare-rpc); bundle a Bare app; handle app suspension.
- **Gaps / flags:** minimum iOS/Android versions not stated; no Expo configuration details; known bugs in 0.15.6/0.16.0 (`start(filename)` without args array throws; static `Worklet.wakeup()` throws); whether the full Hypercore stack and its native addons run on Bare is implied but **not demonstrated on any page read**.

### bare-bluetooth (Diagram only; optional)
- `bare-bluetooth` (+ `bare-bluetooth-apple`, `bare-bluetooth-android`): BLE scan, GATT read/write/notify and L2CAP streaming channels on iOS, Android, macOS and Linux; used in mobile guides with a React Native Bare worklet.
- **Gaps / flags:** the page does **not** cover Hypercore/Corestore replication over Bluetooth, range, throughput or the exact permissions; the earlier mention of `ble-swarm` did not appear on this page.

### DE Ledger via Ledfra (Link: ledfra.com)
- **What:** hosted double-entry ledger API for multi-party money movement. Balance enforced at write time (unbalanced = 400). Entries immutable. Accounts are slugs (`liabilities:user/123`) created on first reference; "guarded" accounts cannot go below zero (422). Transactions have description, metadata and entries `{account, DEBIT|CREDIT, amount "CUR:value"}`. `POST /api/ledgers/{ledgerId}/transactions` with Bearer token; `Idempotency-Key` header (409 if reused with a different body). Real-time balances, trial balance, P&L, balance sheet derived from entries. OpenAPI spec and sandboxes mentioned.
- **Pricing:** free for 6 months from workspace creation; Early Access $99/month locked if workspace created before 2026-12-31; Growth $399/month from 2027-01-01; includes 30,000 posted transactions/month, then $10 per 1,000.
- **Gaps / flags:** **self-hosting, SDKs, gRPC, licence, tenant isolation, rate limits, reversal semantics, retention/export, data residency, FX rules: all unstated.** Tension with the digital-sovereignty principle (hosted third-party).

### System 1 Decision Model via Laya (Link: huggingface.co/convaiinnovations/laya)
- **What:** multilingual, non-autoregressive "System 1" decision model (~0.4B params: 421M English root on ModernBERT-large, 322M multilingual on mmBERT-base, plus a `typed-decisions` fine-tune). Never generates text. Input: state (text/email/ticket/JSON) + typed questions (`choice`, `score`, `noul` yes/no). Output: typed answers with calibrated probabilities. Apache-2.0. Python 3.10+; PyPI `laya` **0.4.14** (the unrelated npm package named `laya` must not be used). `Router(preload=True).predict(state, questions)`; `laya-serve` exposes `POST /v1/systemone` (set `LAYA_API_KEY`, otherwise binds 0.0.0.0 unauthenticated). Measured on a T4 GPU: 33-40 ms single question; CPU 193-464 ms.
- **Gaps / flags:** zero-shot is weak on the page's benchmark (0.362 base vs 0.461 majority baseline; 0.766 only after fine-tune). Weak on >20 options (Banking77 0.425) and ordinal scores; `noul` label bias (issue #156); `act_probability` unusable (issue #185, gate on `confidence`); overconfident until temperature-refit; accuracy varies past ~4,000 tokens. **Needs our own labelled data, fine-tune and calibration.**

### OCR via Unlimited OCR (Link: huggingface.co/baidu/Unlimited-OCR)
- **What:** Baidu ~3B-parameter vision-language document parser (BF16 Safetensors, ~6 GB weights), MIT. Single images ("gundam" crop mode), multi-page and PDFs (rasterised at 300 DPI, base mode only). Outputs text with grounding markers `<|det|>type [bbox]<|/det|>` (block types and bounding boxes). Run via transformers (`trust_remote_code=True`, CUDA/bfloat16), vLLM (`vllm/vllm-openai:unlimited-ocr`, OpenAI-compatible server), SGLang, or Docker Model Runner. `max_length` 32,768.
- **Gaps / flags:** only NVIDIA GPUs documented; no VRAM/throughput/latency numbers; multilingual but languages unnamed; output Markdown-vs-JSON unclear; ParseBench figures unexplained; SGLang section internally inconsistent (kernels version). **Server-side GPU service, not on-device.**

## Finance

### Payment Processor via Stitch (Link: docs.stitch.money)
- **What:** South African payments API (GraphQL, `https://api.stitch.money/graphql` for test and live). Pay By Bank (Capitec Pay incl. VRP, Absa Pay, PayShap Request/RTP), card, DebiCheck, manual EFT, cash, crypto pay-ins; disbursements for payouts.
- **Create a payment:** `clientPaymentInitiationRequestCreate(input:{amount:{quantity,currency}, payerReference<=12, beneficiaryReference<=20, externalReference<=4096, expireAt, payerInformation:{payerId}, paymentMethods:{eft:{enabled:true},card:{enabled:false}}})` returns `paymentInitiationRequest{id url}`; redirect the user to `url` with `redirect_uri` (allowlisted, HTTPS in production).
- **Result:** webhooks on `payment` events (`PaymentInitiationRequestCompleted/Cancelled/Expired`) are the source of truth; redirect parameters are untrusted; poll with `node(id)`; cancel with `clientPaymentInitiationRequestCancel`. Scope `client_paymentrequest`. Test: `testClientPaymentInitiationRequestSimulateComplete` plus scenario triggers (amount, references, account numbers). RTP limits (ZAR): 3,000 (Absa, African Bank, Capitec, Investec, Standard Bank); 10,000 (FNB); 50,000 (Discovery, Nedbank). Mobile: use Chrome Custom Tabs / SFSafariViewController, not a raw WebView.
- **Gaps / flags:** disbursement API, client-credentials details, webhook signature method, payment links, account linking, settlement times, fees, go-live steps were **not covered** in the fetched pages.

### Stablecoin: ZARP (Link: zarpstablecoin.com/about)
- **What:** Rand stablecoin issued by ZARP Stablecoin (Pty) Ltd. Contract `0xb755506531786C8aC63B756BaB1ac387bACB0C04` on Ethereum, Base and Polygon; Solana mint `dngKhBQM3BGvsDHKhrLnjvRKfY5Q7gEnYGToj9Lk8rk`. Docs at docs.zarpstablecoin.com; contract source `venox-digital-assets/zarp.contract`; partner application form.
- **Gaps / flags:** mint/redeem rails, fees, KYC not stated. Regulatory position is in flux: the site says services are provided "as a representative of Inves Capital (Pty) Ltd" and a **CASP licence is pending**. Only a 2021 attestation (Kempen) is named. Gnosis contract not listed.

### Stablecoin: ZARsc via Supercoin (Link: supercoin.co.za)
- **What:** ZAR stablecoin "ZARsc" on **Solana**, Token-2022, 6 decimals, mint `5ekaHEqpRUXH4RoZVRMErdJE74bibWAzihMtPcjKyceQ`. Claimed 1:1 backing in segregated accounts at Absa; monthly agreed-upon-procedures reports by Moore (ISRS 4400); Fireblocks wallet infrastructure; buy/redeem via Luno, VALR, OVEX, Orca; payments via Luno Pay, Zapper. Issuer entity named as Super Money SA (Pty) Ltd (FSP #53458).
- **Gaps / flags:** **no public API/SDK/sandbox**; mint/redeem mechanics, limits, fees, Token-2022 extensions on the mint (freeze/permanent-delegate/transfer-fee) unverified; agreed-upon procedures are not an audit opinion; consumer wallet not launched.

## Logistics

### GIS: Kepler.gl (Link: kepler-preview.foursquare.com)
- **What:** the linked preview page returned no content (title "kepler.gl demo"). Using the open-source repo `keplergl/kepler.gl` (MIT): React + Redux component on MapLibre GL and deck.gl; packages `@kepler.gl/components` (`KeplerGl`), `@kepler.gl/reducers` (`keplerGlReducer`, `enhanceReduxMiddleware`), `@kepler.gl/actions` (`addDataToMap`, `forwardTo`); data loaded as `{fields, rows}`; a SQLRooms demo (`@kepler.gl/sqlrooms`) pairs it with a DuckDB-style SQL panel. Node >= 20.
- **Gaps / flags:** supported file formats, layer types and performance limits not stated; what "kepler-preview" is relative to the open-source release is unknown. React/DOM only (no React Native); in the mobile app it runs as a bundled page in a WebView (AD-20; built and checked in `miniapps/vendor/delivery`, v3.2.6).

### DuckDB-WASM (Link: duckdb.org/docs/1.5/clients/wasm/overview)
- **What:** `@duckdb/duckdb-wasm` (MIT). Bundle selection, Web Worker, `AsyncDuckDB`, `db.connect()`, `conn.query(sql)`, Arrow results. Parquet reads fetch only needed byte ranges via the JS httpfs path (`LOAD httpfs`; the built-in path may download whole files, issue #2153). Core extensions `spatial`, `parquet`, `json`, `icu` available via `INSTALL`/`LOAD` (INSTALL only records the source; LOAD fetches and signature-verifies). 4 GB WebAssembly ceiling; single-threaded by default.
- **Gaps / flags:** the docs say latest stable is **1.5.6** but npm `latest` currently resolves to `1.33.1-dev57.0` (modified 2026-10-22): **pin the version explicitly**. OPFS persistence, GeoJSON handling and Node support not covered. Browser-only for our purposes.

### Route Planning via Valhalla-WASM (Link: github.com/tobilg/valhalla-wasm)
- **What:** `valhalla-browser` 0.2.1 (published 2026-09-21) and `valhalla-server` (MIT). `createRouter({manifestUrl, transport, wasmMemory, memoryBudgetBytes, timeoutMs, retries})`; `router.route({origin, destination})` or `{locations, costing}`; results in km/seconds/polyline6; costing `auto`, `bicycle`, `pedestrian`, `truck` (height, width, length, weight, axle_load, hazmat); runs in a Web Worker (browser) or worker thread (Node); only one native operation at a time; `cancel()` terminates the worker. **Not bundled with map data:** you build graph tiles from an `.osm.pbf` (`pnpm run data:osm`) and host them (S3/R2/MinIO) behind a manifest. Memory defaults 128/512 MiB browser. CSP needs `'wasm-unsafe-eval'`, `blob:` in `worker-src`. ODbL attribution required for OSM data.
- **Gaps / flags:** **isochrone, matrix, optimised route, map matching and locate are not documented**; `motor_scooter` not mentioned. Desktop Chromium/Firefox/WebKit verified; **mobile not established**; no offline/OPFS/IndexedDB caching. South Africa coverage and tile size not stated.

## Intelligence

### LLMs (Diagram only)
- Provider-agnostic access is provided by `@earendil-works/pi-ai` ("OpenAI, Anthropic, Google, etc.") and by OpenCode's provider config. Local OpenAI-compatible endpoints (for example vLLM, which Unlimited-OCR also uses) are the sovereignty fallback. Model choice is an open decision (D-7).

### Opencode/Pi: Pi (Link: github.com/earendil-works/pi)
- **What:** minimal, extensible agent harness (MIT). Packages `@earendil-works/pi-ai`, `pi-agent-core` (1.4.0), `pi-coding-agent`, `pi-tui`, `pi-durable`, `chord`, `pi-telemetry`. SDK `createAgentSession({cwd, model, modelRuntime, customTools, tools, noTools, excludeTools, resourceLoader, sessionManager})`, `session.prompt()`, `session.subscribe()` (`message_update`, `message_end`, `agent_settled`), `session.dispose()`, `SessionManager.inMemory()`; `tools: ["read","grep","find","ls"]` selects built-ins; **custom tools are registered through the extensions system with `pi.registerTool()`** (example `06-extensions.ts`, not read). Models: `models.json` provider entries with `baseUrl`, `api` (e.g. `openai-completions`), `apiKey`, `models`; Ollama, LM Studio, vLLM and SGLang are named as compatible endpoints; credential precedence is `--api-key`, stored `auth.json`, `models.json`, then environment.
- **Gaps / flags:** **no built-in permission system**; isolation is ours. The `modelRuntime` SDK credential API and the exact tool schema/`execute` signature are undocumented on the pages read. Node/Bun SDK (Node 22.19+).
- **Versions (checked 2026-10-26):** npm `latest` is `1.4.0` (MIT, source https://github.com/earendil-works/pi, package https://www.npmjs.com/package/@earendil-works/pi-coding-agent). The CLI installed on the spike machine was `0.85.1`, whose README says "No MCP" and "permission popups" are intentionally left out (README line 499 and `docs/usage.md` line 309 of that install). **1.4.0 ships MCP**: `docs/mcp.md` in its package describes stdio and streamable HTTP servers in `~/.pi/agent/mcp.json`, tools named `mcp__<server>__<tool>`, exposure modes (`direct`, `codemode`, `deferred`, `hidden`), and MCP calls passing through extension `tool_call` hooks. Read from the npm tarball, not the repo.
- **Spike 11.1 (run 2026-10-26, offline except npm, no credentials):** `pi -p` with `--no-builtin-tools --no-extensions -e <stub extension>` offered only the extension's tools; the stub's `tool_call` hook logged both calls and blocked the money tool before it ran (0.85.1 and 1.4.0 behaved the same). Pi 1.4.0 connected to the stub MCP server (`pi mcp list`). With `--tools 'mcp__ocn__*'` the model still saw a built-in `codemode` tool and tried a shell call through it; in the two runs checked (a marker-file test) no shell command ran. Not exhaustively tested. Gate: extension hooks only; no allow/ask/deny rules and no approval prompt were tested in print mode.

### Opencode/Pi: OpenCode (Link family: opencode.ai docs read 2026-10-24)
- **Server:** `opencode serve` (flags `--port` 4096, `--hostname` 127.0.0.1, `--cors`, `--mdns`); HTTP basic auth via `OPENCODE_SERVER_PASSWORD` (username `opencode`); endpoints for sessions (`/session`, `/abort`, `/fork`, `/revert`, `/permissions/:permissionID`), messages (`POST /session/:id/message`, `/prompt_async`), SSE `/event` and `/global/event`, files, agents (`/agent`), experimental tool schema listing; **OpenAPI 3.1 at `/doc`**. TLS support not documented.
- **SDK** `@opencode-ai/sdk` 1.19.4 (MIT): `createOpencode({hostname, port, config})`, `createOpencodeClient({baseUrl})`, `session.create/list/abort/prompt` (`noReply`), `event.subscribe()`, `auth.set`; **structured output** with `@opencode-ai/sdk/v2` (`format: {type:"json_schema", schema, retryCount}`).
- **Config:** `permission` with `allow`/`ask`/`deny`, global and per tool, with glob patterns (`*`, `?`), last match wins, per-agent overrides; defaults mostly `allow` (`doom_loop`, `external_directory` default `ask`; `.env` reads ask). Providers: custom OpenAI-compatible via `@ai-sdk/openai-compatible` with `options.baseURL` and `{env:...}` keys (Ollama and llama.cpp examples; vLLM not shown). MCP: `type: "local"` (command, environment, cwd, timeout) or `"remote"` (url, headers, oauth); disable by glob in `tools`. Custom tools: files in `.opencode/tools/` using `tool()` from `@opencode-ai/plugin` with zod; same name as a built-in replaces it.
- **Gaps / flags:** OpenCode 1 and 2 share the `opencode` command and cannot be installed side by side; how permission requests surface in SDK mode is only named; the page does not document a dedicated "disable all built-ins" switch (use `deny`); the per-agent `tools` section is marked deprecated.
- **Spike 11.1 (run 2026-10-26, OpenCode 1.19.4, npm `opencode-ai`, MIT, https://www.npmjs.com/package/opencode-ai):** all runs used the HTTP API directly, with an isolated config (`OPENCODE_CONFIG`, XDG dirs) and a stub MCP server (`type: "local"`) and Ollama `qwen3.5:9b` through `@ai-sdk/openai-compatible` (tool calls worked).
  - `opencode serve --hostname 127.0.0.1` with `OPENCODE_SERVER_PASSWORD`: a request without credentials got 401; `/global/health`, `/doc` and `/mcp` answered.
  - `permission: {"*": "deny", "ocn_order_propose": "allow", "ocn_money_pay": "ask"}`: a built-in `bash` call the model made was refused as an unknown tool, and the error listed only the two MCP tools, so denied built-ins were removed from the model's tool list, not only refused.
  - `ask`: the server emitted an SSE `permission.asked` event (`/event`) and the request waited; `POST /session/:id/permissions/:permissionID` with `reject` returned an error to the model, and the MCP server never received the money call. The approve path was not run.
  - Under `bwrap --unshare-net` (bubblewrap, no network) the server started, the MCP server connected and an external HTTPS request failed. A full model run inside the namespace was not done, because the model endpoint is on host loopback.
  - **Caution:** the model wrote "output: hi" for the refused bash call, and in Pi it reported a blocked payment as processed. The tool-call trail and the MCP server's own log are evidence; the model's text is not.
  - Not verified: the `createOpencode` SDK path and typed permission events, custom `.opencode/tools`, TLS, unix sockets, and first-run behaviour without the npm provider package cached.

### Gen UI via OpenUI (Link: openui.com/docs)
- **What:** open standard for Generative UI. **OpenUI Lang** is a compact language models emit; a `Renderer` shows each component as its line streams. Packages `@openuidev/react-lang` 1.0.1 (`createLibrary({root, components})`, `Renderer`), `@openuidev/lang-core` (`generateSystemPrompt`), `@openuidev/cli` (`create`, `generate ... --spec`). Optional hosted Gateway (`api.thesys.dev`) validates/repairs; Autofix repairs invalid output with one API call. `<Renderer response library isStreaming onAction />`. Listed integrations include React Native, Vercel AI SDK, LangChain, assistant-ui.
- **Gaps / flags:** component schema syntax, tool calling, the shape of the `onAction` object and a security model are not on the page. Gateway/Autofix are hosted services (sovereignty trade-off); the system prompt can be generated locally.

## Cross-cutting

### Hyperbee / Hyperdrive linkage in the diagram
- The diagram links **Intelligence** and **Data** to "Hyperbee and Hyperdrive" (storage substrate) and **Data** to "Hyperswarm and HyperDHT" (replication/discovery). Interpreted in `architecture.md` section 4.

## Open facts to verify before build (carried into spikes)

| # | Question | Owner epic |
|---|---|---|
| F-1 | Does the Corestore/Autobase/Hyperbee/Hyperswarm stack, with its native addons linked via `bare-link`, run in a Bare worklet inside an Expo app on a low-end Android device and on iOS, within memory and suspension limits? | 3 |
| F-2 | Does ts-ucan run under Hermes/Expo, and is it acceptable at 2023 vintage, or do we move to `iso-ucan`? | 2 |
| F-3 | Can Ledfra give per-community tenancy, reversals, export and (ideally) self-hosting? | 4 |
| F-4 | Stitch disbursements: API, limits, settlement times, webhook signature method | 4 |
| F-5 | ZARP vs ZARsc: legal/regulatory position, mint/redeem path, API access, custody | 5 |
| F-6 | Unlimited-OCR accuracy on real SA supplier price lists/invoices; GPU sizing | 6 |
| F-7 | Laya accuracy after fine-tune on our decisions; calibration; label cardinality | 6 |
| F-8 | Valhalla tiles for the target region; mobile viability; need for matrix/optimised multi-stop | 7 |
| F-9 | DuckDB-WASM spatial + OPFS in practice; correct version to pin | 3, 7 |
| F-10 | OpenCode server mode vs Pi: deny-by-default permissions, MCP capability server, sandbox, provider config for a local endpoint, how permission requests surface in SDK mode | 11. **Answered by spike 11.1 (2026-10-26), AD-10 confirmed**: deny-by-default, MCP, local endpoint and HTTP permission replies verified; open: the SDK's typed permission events, TLS, the sandbox technology (D-9), and a real UCAN check |
| F-11 | OpenUI action model and security; local-only (no Gateway) operation | 11 |
| F-12 | HyperDHT `firewall` return semantics (docs contradict themselves) and own-bootstrap behaviour | 3 |
| F-13 | Can Corestore replicate over a `bare-bluetooth` L2CAP channel for nearby offline sync? | 3 |
| F-14 | Hyperdrive large-file behaviour on-device; deriving Corestore `primaryKey` from an identity seed safely | 3, 2 |
