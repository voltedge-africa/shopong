# Which `@duckdb/duckdb-wasm` version do we pin?

Captured 2026-10-24. Commands:
`npm view @duckdb/duckdb-wasm dist-tags versions time --json`,
`GET https://api.github.com/repos/duckdb/duckdb-wasm/releases?per_page=6`.

## What npm actually offers

| thing                     | value                                             | date       |
| ------------------------- | ------------------------------------------------- | ---------- |
| npm `latest` tag          | **1.33.1-dev57.0**                                | 2026-06-22 |
| npm `next` tag            | **1.33.1-dev110.0**                               | 2026-10-22 |
| newest true stable on npm | **1.32.0**                                        | 2025-12-16 |
| total published versions  | 448 (after 1.32.0 only `1.33.1-dev*.0` snapshots) |            |

The duckdb.org 1.5 wasm docs describe DuckDB engine **1.5.6**, but _no npm release_ packages
that engine as stable: engine 1.5.6 arrives only inside the dev snapshot `1.33.1-dev65.0`.
npm's `latest` tag itself resolves to a dev build (`1.33.1-dev57.0`, engine v1.5.4) and has been
re-pointed silently since 2026-06 — exactly the drift this spike exists to pin out.

## GitHub releases vs npm

`v1.33.0` exists as a non-prerelease GitHub release (2025-12-16, "no real differences from
1.32.0, NPM publishing setup had been off") but **was never published to npm** — `npm view
@duckdb/duckdb-wasm@1.33.0` returns E404. So the last real npm-mirrorable stable is 1.32.0.

## Bundled engine per npm version (measured, results/version-matrix.json)

| npm version               | engine (`select version()`)           | behaviour in the spike                                                                                                                                                       |
| ------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.32.0                    | v1.4.3 (`wasm_eh`, source d1dc88f950) | all steps pass: JSON load, Arrow load, all 6 aggregate queries, LOAD spatial, parquet round-trip, Kepler shaping                                                             |
| 1.33.1-dev57.0 (`latest`) | v1.5.4                                | all steps pass; extensions fetched from v1.5.4 repo dir                                                                                                                      |
| 1.33.1-dev65.0            | v1.5.6 (matches docs)                 | all steps pass; GEOMETRY is a core type (see results/core-geometry-without-load-spatial.json)                                                                                |
| 1.33.1-dev110.0 (`next`)  | v2.0.0-dev88614                       | **broken for our load path**: autoloading JSON extension fetches `extensions.duckdb.org/<hash d54cbbe3df>/…` which 404s, so json load + aggregates + parquet fail by default |

## Recommendation

**Pin `npm:@duckdb/duckdb-wasm@1.32.0`** (exact, no ranges), lockfile committed.

Reasoning:

1. Newest npm version that is a real stable release; deterministic (`select version() -> v1.4.3`) across installs.
2. Passing a dev build's tag (`latest`=dev57, `next`=dev110) would let the engine drift between installs and today's `next` is unusable without ext-repo surgery.
3. Its engine has a matching self-hostable extension directory (`v1.4.3/wasm_eh` on extensions.duckdb.org), which we mirror with sha256s (results/extensions-v1.4.3-wasm_eh.json) — satisfies "no third-party CDN at runtime".
4. Functional surface we need (JSON rows, Arrow rows, aggregates, `LOAD spatial` + ST_*, GeoJSON via ST_Read/ST_AsGeoJSON, OPFS, strict CSP with `'wasm-unsafe-eval'` and `blob:` workers) all verified against 1.32.0.

When a stable npm release bundles engine ≥ 1.5 (GEOMETRY as core type, ST_Hilbert, ST_Transform),
re-run `scripts/version-matrix.mjs` against it and move the pin.
