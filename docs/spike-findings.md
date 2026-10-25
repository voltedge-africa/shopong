# Spike findings

What the four phase 1 spikes found out, in one place. The spike folders (`spikes/`) held throwaway
experiments, their raw results and their own lockfiles. They have been removed from the repo; this
document is what was worth keeping.

- **Where the originals are.** Commit `9bc22c4` (the last `main` before the removal) contains the whole
  `spikes/` tree. For example: `git show 9bc22c4:spikes/7-1-valhalla/results/README.md`, or
  `git restore --source=9bc22c4 --worktree -- spikes/` to bring it all back.
- **What the plan documents say.** Nothing under `_bmad*` was changed. The edits this work implies for the
  architecture and the technology register are listed in [Changes the plan needs](#changes-the-plan-needs).
- **Honesty about evidence.** Every spike ran on a Linux workstation, in Node, Bare or headless
  Chromium. **None ran on a phone, in Expo, or on Hermes.** Each result below says whether it was run
  or only analysed.

## At a glance

| Spike                          | Question                                                        | Answer                                                                                                | Confidence                                    |
| ------------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 2.1 UCAN library               | Which library carries `CapabilityAuth` on Expo?                 | `iso-ucan` 2.0.0, conditional on a device test that has not happened                                  | Contract tests run; Hermes bundles built only |
| 3.1 Bare worklet and Hypercore | Does the shared-record design hold, and does it fit on a phone? | The design holds in Bare on Linux; fit on a phone is **not established**                              | Run on Linux only, not in Expo                |
| 3.8 DuckDB-WASM in the console | Which version, and does it work under a strict CSP?             | Pin `@duckdb/duckdb-wasm` **1.32.0** (engine v1.4.3); works under CSP once extensions are self-hosted | Run in headless Chromium only                 |
| 7.1 Valhalla-WASM              | Can we route from our own tiles, and plan multi-stop runs?      | Yes for single routes. Matrix and optimised routes exist in the engine but not in the SDK             | Run in Node and headless Chromium; no phone   |

## Spike 2.1: UCAN library

**Question.** Which capability-token library sits behind `CapabilityAuth`, given that verification must be
a pure function of its inputs and an explicit log time (AD-6)?

**Method.** The repo's real `CapabilityAuth` contract (17 tests) was run in three variants (normal;
clock and network trapped during `verify`; issue-time attenuation checks off) against three candidates:
17 x 3 = 51 assertions each. Result: 188 passed, 3 expected failures, 0 failed.

|                                 | `@ucans/ucans` 0.12.0 (ts-ucan)     | `iso-ucan` 2.0.0           | In-house minimal chain (prototype) |
| ------------------------------- | ----------------------------------- | -------------------------- | ---------------------------------- |
| Spec and licence                | UCAN 0.8.1, Apache-2.0              | UCAN 1.0, MIT              | Signed canonical JSON              |
| Last published                  | 2023-07-25                          | 2026-10-01                 | n/a                                |
| Takes an explicit time          | **No**: `verify` reads `Date.now()` | **Yes**: a `now` parameter | **Yes**                            |
| Capability logic we still own   | about 130 lines                     | about 250 lines            | all 318 lines                      |
| Library bundle (minified, gzip) | 38,421 B                            | 61,743 B (1.6x)            | 13,871 B (0.36x)                   |

**What we learned**

- **Determinism decides it.** ts-ucan cannot take a log time. The adapter has to switch off the library's
  time checks and re-implement the validity window, chain walk and nearly all capability rules, so the
  library supplies only identity, the token codec and signature checks.
- **iso-ucan does more, but its model is not ours.** It enforces command narrowing, resource globs and
  ceilings through its policy engine. It still has two gaps the adapter must close: it has **no rule that a
  child cannot outlive its parent**, and its expiry is **inclusive in whole seconds** where the port is
  exclusive in milliseconds. Mapping our resource, ability and ceiling model onto UCAN 1.0's subject,
  command and policy model is about 90 lines and the likeliest place for subtle bugs.
- **Bundle size.** The app-level phase 1 figure (iso-ucan about 3.5x ts-ucan, 121.2 KB against 35.1 KB
  gzip) could not be reproduced. The reproducible library-level figure is 1.6x. Quote the 1.6x number and
  say it is library-only.
- **Same identity from the same seed.** All three produce the same `did:key` from one seed, matching
  RFC 8032 and an independent `did:key` encoding. The spike used HKDF-SHA-512 (salt `ocn/kdf/v1`, separate
  labels for the identity seed and the Corestore primary key, seed of at least 128 bits).
- **The contract suite has a bug.** In verify-only mode the case "a delegation from someone the proof was
  not issued to is refused" expects `broken_chain`, but the leaf expires exactly at the log time so
  `expired` is also correct. It fails for the in-memory reference adapter too. It was marked `it.fails`.
  Fix the case in `@shopong/ports-contract`; do not leave it as an expected failure.
- **Hermes: bundled, never run.** Metro compiled all three adapters for Android (Hermes bytecode, about
  3 MB), iOS (about 3 MB) and web (about 1.3 MB). Nothing ran on a device or emulator.

**Polyfills the bundle needs on Hermes.** `crypto.getRandomValues` from `expo-crypto`; `crypto.subtle.digest`
from `@noble/hashes` (pure JS); `Buffer` and `stream` through Metro `extraNodeModules`; `.js`-to-`.ts`
resolution and `node:` prefix stripping. `TextEncoder`, `TextDecoder`, `structuredClone`, `atob` and `btoa`
were checked at startup and reported if missing, not silently shimmed.

**Decision (proposed, not final).** Use `iso-ucan` 2.0.0 behind `CapabilityAuth`; keep ts-ucan out of the
implementation path; keep the in-house prototype only as a reference for a future second adapter. The
decision is conditional on a device smoke test: all adapters must pass the contract 17/17 plus the seed
check on Hermes, on a low-end Android phone and an iPhone, with no missing polyfills. The full record is
`docs/decisions/2-1-ucan-library.md`.

**Still open**

- Run the contract on Hermes on real devices and note cold-start time and memory.
- Fix the contract-suite case above.
- No independent security review of any candidate, least of all the in-house prototype.
- Per-candidate native bundle sizes (the probe bundled all three together).

## Spike 3.1: Bare worklet and Hypercore

**Question.** Does the shared-record design (Autobase with our own `apply`, over Hyperswarm) behave as the
architecture assumes, and does it run inside a React Native worklet?

**What was run.** Bare 1.33.4 on Linux x64, not inside Expo. Only phase 1 was done.

| Check                                                                                           | Result                   |
| ----------------------------------------------------------------------------------------------- | ------------------------ |
| Writer admission through `host.addWriter` inside `apply`; a non-admin `member.added` is refused | Pass                     |
| Writers that diverge offline converge after reconnecting over Hyperswarm, with no lost events   | Pass                     |
| Replication through `base.replicate(conn)`, not `store.replicate`                               | Pass                     |
| `signedLength` advances once an indexer acks (22 to 34 after reconnect and ack)                 | Pass                     |
| Replaying in different arrival orders gives an identical view (same SHA-512)                    | Pass                     |
| AD-18: the same `primaryKey` from the seed restores the same writer keys on an empty directory  | Pass, with caveats below |
| F-12: what the HyperDHT `firewall` return value means                                           | Measured, below          |

Timings on one machine: connect 25 ms, writable after admission 15 ms, reconverge 9 ms. The 10,000-event
benchmark **timed out** in this environment, so there is no throughput number.

**HyperDHT firewall semantics (resolves the architecture's open question).** Returning `true` **blocks**;
returning `false` or `undefined` **allows**; a thrown error **blocks** (fails closed); an async firewall is
awaited. On Hyperswarm, the **server side** passes an async firewall through and awaits it, but the
**client side is synchronous only**: a Promise is truthy, so it blocks even when it would resolve `false`.
Write firewalls so they never rely on an async check on the dialling side.

**AD-18 (one recovery phrase restores identity and writer keys) works, with sharp edges**

- Passing `primaryKey` requires `unsafe: true`. Without it Corestore throws.
- Corestore **stores the primary key in its own storage in plaintext**. Treat the storage directory as
  secret material.
- A different `primaryKey` against existing storage is refused ("Another corestore is stored here").
- A naive restore (open Autobase on an empty store) gets the same writer keys and is **writable without
  re-admission**, but it does **not** apply its own earlier history. Pre-syncing the writer core **before**
  opening Autobase linearises the history (3 of 3 pledges recovered). Build restore as pre-sync, then open.
- A restored device can append locally before it has synced. That needs a deliberate decision and a test.
- The spike used libsodium `crypto_kdf_derive_from_key` with contexts (`ocnident`, `ocnstore`) and
  Argon2id for phrase to seed (about 370 ms on a desktop). Spike 2.1 used HKDF-SHA-512 with other labels.
  **These two schemes must be reconciled in one design** (stories 2.6 and 3.1) before either is built on.
- The default `fastForward` stalled until after an ack and reconnect, then healed.

**Not established.** Whether the Hypercore stack and its native addons run inside a Bare worklet in Expo on
a low-end Android phone, which is risk R-1. This spike did not touch it, so R-1 is **not** retired.

## Spike 3.8: DuckDB-WASM in the web console

**Question.** Which `@duckdb/duckdb-wasm` version do we pin, and does it work under a strict CSP with no
third-party network?

**Method.** Headless Chromium 153, a pinned and self-hosted build, strict CSP enforced by the test server,
and a harness that aborts and fails on any cross-origin request. Latency numbers are the median of 3 runs.

**Version.** Pin **`npm:@duckdb/duckdb-wasm@1.32.0`** exactly (engine `v1.4.3`), with the lockfile
committed.

- npm `latest` is **`1.33.1-dev57.0`**, a development build (engine v1.5.4), and has moved silently since
  June 2026. `next` (`1.33.1-dev110.0`) is broken for our load path because its extension autoload 404s.
- `v1.33.0` exists as a GitHub release but was **never published to npm**.
- The duckdb.org 1.5 docs describe engine 1.5.6, but no stable npm release packages that engine; it only
  ships inside the dev snapshot `1.33.1-dev65.0`. When a stable npm release bundles an engine of 1.5 or
  later, re-run the version matrix and move the pin.

**What works** (all on 1.32.0): JSON and Arrow row loads at 10k and 200k rows, six aggregate queries,
`LOAD spatial` with `ST_*`, GeoJSON through `ST_Read` and `ST_AsGeoJSON`, Parquet round trips, and OPFS
persistence (survives reload, an uncheckpointed write, and a browser restart).

| Measure           | 10,000 rows     | 200,000 rows       |
| ----------------- | --------------- | ------------------ |
| Arrow load        | 39 ms           | 200 ms             |
| Aggregate queries | about 2 to 5 ms | about 4.5 to 15 ms |
| Peak JS heap      | n/a             | 67 MB              |

Cold start (navigate to a connected database) 828 ms median. The WASM module is 34.24 MB raw and 7.68 MB
gzip; the worker is 0.77 MB raw. The spatial extension is 23.5 MB raw and 5.27 MB over the wire with brotli.

**Lessons**

- **CSP policy that works:** `script-src 'self' 'wasm-unsafe-eval'`, `worker-src 'self' blob:`,
  `connect-src 'self'`. Without `'wasm-unsafe-eval'` nothing runs.
- **Stock `apache-arrow` breaks under that CSP.** Its builder compiles a function with `new Function`,
  which needs `'unsafe-eval'`. The spike replaced it with a small closure-based shim. Use the shim, not
  `'unsafe-eval'`.
- **Extensions must be self-hosted.** The default repository (`extensions.duckdb.org`) is blocked by the
  CSP, and `LOAD spatial` then fails. Mirror the extension files from the same origin (hashes recorded
  below), set `custom_extension_repository`, and turn off `autoload_known_extensions` and
  `autoinstall_known_extensions`. Once cached, a self-hosted extension works offline; the default
  repository does not.
- **Unsigned or tampered extensions are rejected** by DuckDB's signature check, which is what we want.
- **`LOAD spatial` first.** Without it there are no `ST_*` functions in the catalog on 1.4.3.
- **A query failed silently, and the cause was a chain of three things.** `ts_ms` loads as `UBIGINT`;
  `to_timestamp()` returns `TIMESTAMPTZ`; and `date_trunc` over `TIMESTAMPTZ` needs the ICU extension,
  which the CSP refused to fetch. The fix is the core-only path
  `date_trunc('month', make_timestamp(ts_ms::BIGINT * 1000))`. The earlier driver swallowed the error, so
  **measurement scripts must fail loudly**.
- **One tab at a time with OPFS.** A second tab opening the same database while the first is open fails
  (`createSyncAccessHandle` cannot be created while another handle is open). The console must handle that.
- **Threaded (COOP/COEP) bundle** is available but not needed; the single-threaded `eh` bundle passed
  everything. A non-EH fallback bundle also loaded.

Extension hashes (v1.4.3, `wasm_eh`, sha256), to pin in the mirror:

| Extension | Raw bytes  | sha256                                                             |
| --------- | ---------- | ------------------------------------------------------------------ |
| spatial   | 23,469,719 | `04b776946da64a15a7b14501790c75093e38f876acc46b2922f0daeb6aaa1d60` |
| parquet   | 3,045,039  | `22765c8f7dc741cda2b571a66ac7bb355295d7d69a6c37e5315b265672984f55` |
| json      | 820,646    | `b997276c8e15cc3ebdeda340d73d15dc1c4f4755ad281280451cb0a2f79302e9` |
| icu       | 6,503,786  | `c152a87bf98d792ad64ef0b7bf2df89ab06ace37f49edd00b378da6163e8b38c` |
| httpfs    | 389,034    | `5e76d1fb0779c4803ebfd6fb49b80ff833c11b9a6f55208a701e63a491df1d5c` |

**Caveats and open items**

- **Chromium only.** Firefox and Safari were not run. OPFS support differs there.
- **A discrepancy to re-check.** The checked-in CSP matrix (`csp-duckdb-1.32.0.json`) shows `LOAD spatial`
  and Parquet failing in **every** row, apparently because the same-origin extension mirror was not served
  in that run. The written results say the policy passes every step with the mirror. Re-run the matrix
  with the mirror served before relying on the claim.
- Some of the OPFS and extension scenarios (A to F) ran on the dev65 build (engine 1.5.6) and were only
  spot-checked on the pinned version. Re-verify them on 1.32.0.
- Kepler.gl was not part of this spike. Shaping data for it was exercised only as a query step.

## Spike 7.1: Valhalla-WASM and routing

**Question.** Can we route from our own OSM tiles, in Node and in the browser, and can we plan multi-stop
delivery runs?

**Method.** `valhalla-browser` and `valhalla-server` 0.2.1, with tiles built from a pinned Geofabrik
**Eswatini** extract (about 30 MB, ODbL) as a stand-in dataset. Run in Node and headless Chromium.

**Tile build.** 51 tiles in 7.9 seconds (4 threads); `graph.tar` is 22.1 MB (21.1 MiB), indexed by byte
range. Native builder is Valhalla 3.8.3 (pinned revision). A second build of the same PBF gave the same
tile audit but a **different release id**, because the baked config includes a URL that embeds the release
path, so **builds are not byte-reproducible by release id**. Docker is needed for the build.

**Routing numbers (auto costing).** Cold first route 434 to 591 ms (fetching 3 to 8 tiles, 4 to 10 MB);
warm median 12 to 59 ms; repeated calls return identical results. Browser start-up 246 ms; first cold route
566 ms; warm median 44 ms; Chromium tree peak RSS about 764 MiB. WebAssembly memory is 128 MiB initial and
512 MiB max in the browser, 256 MiB in Node.

**Behaviour to design around**

- **The SDK exposes `route` only** (`initialize`, `route`, `diagnostics`, `cancel`, `dispose`), and it
  takes **exactly two locations**. Three locations is `INVALID_REQUEST`.
- **Unsupported costing** (for example `motor_scooter`) is rejected by the SDK with `UNSUPPORTED_COSTING`,
  but the raw engine accepts it. Never rely on raw responses for validation.
- **"Coverage" is the extract's bounding box, not the border.** A point inside the box but in another
  country routes without error.
- **Concurrency.** The queue holds 3; the fifth concurrent call rejects with `QUEUE_FULL`. `cancel()`
  rejects the pending route in about 3 ms but throws away the tile cache (the next route took 525 ms).
  An `AbortSignal` on a queued call rejects only that call.
- **Browser CSP.** The same rule as DuckDB: without `'wasm-unsafe-eval'` in `script-src` the engine will not
  start. Tiles served from another origin must be listed in `connect-src`, or the metadata download fails
  (`NETWORK`). A worker and WebAssembly served from another origin need `blob:` in `worker-src`, or the
  worker fails (`WORKER_FAILED`). A policy of `default-src 'none'` plus `script-src 'self'
'wasm-unsafe-eval'` and `connect-src 'self'` routes correctly when everything is same-origin.

**Other actions exist in the engine but not in the SDK.** The shipped WebAssembly exports only
`vb_init`, `vb_route`, `vb_dispose` and `vb_stats`. A **30-line native patch** plus a wider export list,
rebuilt through the project's Docker stage (about 2 minutes incremental, about 4 minutes first build),
exposed **isochrone, matrix (`sources_to_targets`), optimised route, trace route (map matching), trace
attributes, locate and status**, and every one returned a correct result. Two catches: the dataset's
`loki.actions` is `["route"]` and constructing the actor **throws for any action not listed**, so the
dataset build needs the action names added (the matrix action is named `sources_to_targets`, not
`matrix`); and a new release id is needed for it. Estimate to wire these through the SDK properly: **1 to 2
focused days**.

**Multi-stop planning is viable server-side without a matrix.** Nearest-neighbour then 2-opt, scored with
real routed distances over 8 Eswatini stops: 540.2 km down to 536.1 km, a **0.76% improvement** from one
swap. The cost driver is pair routing, not the optimiser: 56 route calls took about 1.6 seconds warm. An
exposed matrix action would replace those with one native call.

**Not established**

- **Mobile.** Nothing ran on iOS or Android (R-9 still stands). The plan's rule stands: route in the web
  console or on the Node and send the result to the phone.
- **South Africa.** The dataset was Eswatini. Tile size, build time and routing latency for a South African
  or regional extract are unknown, and that is decision D-8.
- The patched runtime was built from source in a local cache and is not part of any published package.

## Lessons that apply to every spike

1. **Pin and record the version of everything, including `latest`.** npm `latest` for DuckDB-WASM was a
   moving development build. Pin exactly and commit the lockfile.
2. **Measure with scripts, not by hand.** The 2.1 bundle sizes recorded by hand could not be reproduced;
   the generated numbers could. Results files should be written by the script that measured them.
3. **Make measurement scripts fail loudly.** Swallowed errors hid a real bug in 3.8 for several runs. A
   failed step, a CSP violation or a third-party request must stop the run with a non-zero exit.
4. **Separate "run" from "analysed".** Every spike says what ran. Bundled is not run; Linux is not a
   phone; Chromium is not Safari.
5. **Test determinism by trapping the environment.** Trapping `Date.now`, `new Date` and `fetch` during
   `verify` caught the library that reads the wall clock. Do the same for `apply`.
6. **Own the semantics the library does not enforce.** For both UCAN libraries the real work was the
   port's rules (attenuation, exclusive expiry, no extending a parent). The contract suite is the guard.
7. **Self-host anything the browser or phone would otherwise fetch.** Extensions, tiles, WebAssembly and
   workers all failed or were blocked once third-party origins were removed. That is the sovereignty rule
   in practice.
8. **A spike is its own pnpm root.** Keeping spikes out of the workspace kept `pnpm run ci` clean. Lift
   only what a story needs into `packages/*`, with its own tests.

## Changes the plan needs

Not made here, because `_bmad*` was left untouched. Do these in a planning change.

1. **Architecture 4.1 and risk R-2.** Name `iso-ucan` 2.0.0 (UCAN 1.0, MIT, published 2026-10-01) as the
   leading `CapabilityAuth` adapter, conditional on the device test; record ts-ucan as rejected (2023,
   wall-clock `verify`). Add an AD for it, with the exit path "another adapter passing the same contract".
   `docs/decisions/2-1-ucan-library.md` lists seven edits in detail.
2. **Architecture 4.2, HyperDHT firewall.** Replace the contradiction with the measured result: `true`
   blocks, `false` or `undefined` allows, a throw blocks, and the Hyperswarm client side is synchronous
   only. Close F-12.
3. **AD-18 and stories 2.6 and 3.1.** Add the restore procedure (pre-sync before opening Autobase), the
   plaintext primary key at rest, the `unsafe: true` requirement, and the need to reconcile the two KDF
   schemes.
4. **Architecture 4.4, risk R-10, story 3.8.** State the DuckDB-WASM pin (**1.32.0**, engine v1.4.3), the
   CSP policy, the Arrow shim, the self-hosted extension mirror with hashes, and the one-tab OPFS limit.
5. **Architecture 4.4, risk R-9, story 7.1.** Valhalla's matrix, optimised route, isochrone and map
   matching exist in the engine and work with a 30-line patch; the SDK exposes only `route`. Estimate 1 to
   2 days to wire through. Multi-stop by nearest-neighbour plus 2-opt is viable now.
6. **Risk R-1 stays open.** No spike put the Hypercore stack inside an Expo worklet on a phone.
7. **Technology register.** Add the facts above (iso-ucan, the DuckDB version drift, the Valhalla
   action list) and mark the firewall and version items verified.

## What is still unverified, in one list

- UCAN on Hermes, on a real low-end Android phone and an iPhone.
- The Bare worklet with the full Hypercore stack inside Expo on a low-end Android phone (R-1), and the
  10,000-event throughput.
- DuckDB-WASM in Firefox and Safari, and OPFS there; the CSP matrix re-run with the extension mirror.
- Valhalla on a phone, and on a South African extract.
- An independent security review of whichever UCAN code ships.
