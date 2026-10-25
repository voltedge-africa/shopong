# Spike 3.8 — DuckDB-WASM in the web console (phase 1 results)

Everything runs on **headless Chromium 153** (`playwright-core`, binary
`~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`), against a **pinned, self-hosted**
`@duckdb/duckdb-wasm` — no jsDelivr, no third-party CDN at runtime, strict CSP enforced by the
test server. Commands are below.

## Verdict

| question                | answer                                                                                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pinned version          | **`npm:@duckdb/duckdb-wasm@1.32.0`** (exact; newest real stable on npm, engine `v1.4.3`). See `versions.md`                                                          |
| JSON + Arrow rows       | yes: `insertJSONFromPath` and `insertArrowTable` both verified at 10k and 200k rows with exact row-count assertions                                                  |
| `LOAD spatial` + `ST_*` | yes, all checks pass, extension self-hosted from the same origin                                                                                                     |
| GeoJSON                 | `ST_Read` of a GeoJSON file works; `ST_AsGeoJSON` works                                                                                                              |
| OPFS                    | works (`opfs://` db path): survives reload, uncheckpointed crash, browser restart — see note below                                                                   |
| no third-party CDN      | verified: harness aborts any non-same-origin request AND asserts none is attempted (any attempt fails the run)                                                       |
| strict CSP              | the {`script-src 'self' 'wasm-unsafe-eval'`, `worker-src 'self' blob:`, `connect-src 'self'`} policy passes every step, incl. `LOAD spatial` from a same-origin repo |

## Measurements (median of 3 runs; spread = min–max across per-run medians)

Setup: `eh` bundle, engine `v1.4.3`, single thread, no COOP/COEP, Synth members/orders/pledges/deliveries.

| metric                        | 10 000 rows      | 200 000 rows        |
| ----------------------------- | ---------------- | ------------------- |
| load (Arrow insert, one shot) | 39 ms (34–43)    | 200 ms (198–202)    |
| spend_per_item                | 2.3 ms (2.1–2.5) | 7.1 ms (6.9–7.4)    |
| who_has_not_paid              | 2.6 ms (2.6–2.8) | 4.5 ms (3.9–5.4)    |
| delivery_hours_per_point      | 1.9 ms (1.8–2.4) | 4.9 ms (4.7–5.0)    |
| price_history_by_month        | 3.7 ms (3.3–4.1) | 11.0 ms (10.3–11.2) |
| three_way_join                | 5.0 ms (4.7–5.1) | 14.9 ms (13.4–15.6) |

Every latency number is the median of 5 executions of the query on fully loaded tables;
runs were sequential and independent (one fresh browser per run).

| metric                                                    | value                                     |
| --------------------------------------------------------- | ----------------------------------------- |
| cold start (navigate → AsyncDuckDB ready + connected)     | **828 ms median** (822–1555 across runs)  |
| WASM module (`duckdb-eh.wasm`)                            | 34.24 MB raw / 7.68 MB gzip               |
| worker (`duckdb-browser-eh.worker.js`)                    | 0.77 MB raw / 0.19 MB gzip                |
| console app bundle (Vite, app + arrow-shim)               | 0.22 MB raw / 0.05 MB gzip                |
| COI/threaded variant (`duckdb-coi.wasm` + pthread worker) | 33.97 + 0.63 MB raw / 7.75 + 0.16 MB gzip |
| peak JS heap while loading + querying 200k rows           | **67 MB** (61–71)                         |

## Spatial (pinned 1.32.0 / engine 1.4.3, all under strict CSP, self-hosted repo)

| check                                                      | result                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------ |
| `INSTALL spatial`                                          | ok                                                                 |
| `LOAD spatial`                                             | ok                                                                 |
| `ST_Point` + `ST_AsText`                                   | ok                                                                 |
| `ST_Distance` / `ST_Distance_Sphere`                       | ok                                                                 |
| `ST_Within` against polygons                               | ok                                                                 |
| `ST_Read('suburbs.geojson')`                               | ok                                                                 |
| `ST_AsGeoJSON`                                             | ok                                                                 |
| members per grid cell / nearest collection point (arg_min) | ok                                                                 |
| spatial extension download (wire, brotli)                  | **5 268 529 B (5.3 MB)** — raw 23 469 719 B                        |
| sha256 (v1.4.3/wasm_eh, pinned in ext-mirror)              | `04b776946da64a15a7b14501790c75093e38f876acc46b2922f0daeb6aaa1d60` |

Without `LOAD spatial` there are **no** `ST_*` functions in the catalog on 1.4.3
(`results/core-geometry-without-load-spatial.json`) — spatial must be loaded before any geo query.

## The SQL bug found (and why a query silently failed before)

`price_history_by_month` used `date_trunc('month', to_timestamp(ts_ms/1000))`. Three facts stack up:

1. `ts_ms` comes back from the JSON loader as **UBIGINT** — most date functions reject it.
2. `to_timestamp()` returns **TIMESTAMPTZ**, and on engine 1.4.3 `date_trunc` over TIMESTAMPTZ
   needs the **icu** extension; under strict CSP the autoloader's fetch of icu from
   `extensions.duckdb.org` is refused → the query died with _“function signature mismatch”_.
3. Earlier runs never noticed because CSP was off, the CDN fetch succeeded, and the per-query
   driver swallowed errors — that swallowed-error behaviour is exactly what the new
   `scripts/measure.mjs` forbids.

Fix, verified by re-running: use the core-only path
`date_trunc('month', make_timestamp(ts_ms::BIGINT * 1000))` (TIMESTAMP, no ICU, no CDN).
`select 1 as month` itself parses fine on both v1.4.3 and v1.5.6 — the “`month` alias” label on
this bug was inaccurate; the alias was never the problem, the UBIGINT→TIMESTAMPTZ→ICU chain was.

## What was RUN in this phase (by me, today) vs ANALYSED

- RUN: full measurement pipeline 3× (`scripts/measure.mjs` → `results/measurements*.json`);
  spatial checks and their wire size; core-geometry matrix re-run; the fail-loudly behaviour
  (its first execution failed on the ICU bug, printed 12 errors and exited 1 — exactly as designed);
  `vp build` + `copy-bundles.mjs` + smoke for the pinned alias; `npm`/GitHub version data (`versions.md`).
- ANALYSED (run by the previous agent, outputs spot-checked, not re-executed here):
  full version matrix across four npm versions (`version-matrix.json`), the extension-sovereignty
  scenarios A–F (`extensions-*.json`), the OPFS persistence scenarios (`opfs-*.json` — note those
  ran on dev65/engine 1.5.6; OPFS semantics should be re-verified on the pinned version in phase 2).

## Reproduce (from `spikes/3-8-duckdb/`)

```sh
pnpm install                                  # own lockfile, outside the pnpm workspace
node scripts/copy-bundles.mjs duckdb-1.32.0   # self-host the DuckDB bundles into public/duckdb/
DUCKDB_ALIAS=duckdb-1.32.0 ARROW_SHIM=1 OUT_DIR=.tmp/dist-duckdb-1.32.0-shim pnpm exec vp build
node scripts/measure.mjs 3                    # 3 runs -> results/measurements-run*.json + measurements.json
node scripts/core-geometry.mjs                # what works WITHOUT LOAD spatial
node scripts/csp.mjs duckdb-1.32.0            # CSP matrix (uses .tmp/dist-duckdb-1.32.0{,-shim})
node scripts/extensions.mjs duckdb-1.32.0 v1.4.3   # extension sovereignty scenarios A-F
node scripts/opfs.mjs duckdb-1.32.0 v1.4.3    # OPFS persistence scenarios
node scripts/version-matrix.mjs               # same checks across all four candidate versions
```

`measure.mjs` fails loudly: any failed step, window error, CSP violation or third-party fetch is
collected, printed and exits 1 (verified live — its first execution failed on the ICU bug above).
