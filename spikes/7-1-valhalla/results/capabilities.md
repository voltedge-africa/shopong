# Spike 7.1 capability probe: which Valhalla actions are really available?

Date: 2026-10-24. Packages: `valhalla-browser` / `valhalla-server` 0.2.1 (from npm).
Evidence: `results/caps-probe.json` (machine-readable), `patches/expose-actions.patch` (the diff that made it runnable).

## How this was determined

1. **Package surface (all three packages are the same engine):** the SDK's public API is
   `Router.{initialize, route, diagnostics, cancel, dispose}` only. `valhalla-core/src/engine.ts`
   issues exactly four native calls: `vb_stats`, `vb_init`, `vb_route`, `vb_dispose`.
2. **Shipped WASM:** `node_modules/valhalla-browser/dist/valhalla-browser.wasm` exports
   `_vb_init`, `_vb_route`, `_vb_dispose`, `_vb_stats` (+ `_malloc`, `_free`). String-scan for
   `vb_isochrone` / `vb_matrix` / `vb_optimized_route` / `vb_trace_route` / `vb_locate` /
   `vb_status`: **0 occurrences** (`vb_route`: 2). No other action exists in the shipped binary.
   `valhalla-server` also has no `wasmUrl` override; only `valhalla-browser` client options
   (`workerUrl`, `wasmUrl`) allow swapping the binary.
3. **Runnable probe (RUN, not just analysis):** `scripts/caps-probe.mjs` loads the
   **patched 0.2.1 runtime we built from source** (`.cache/src/valhalla-wasm/public/wasm/valhalla.*`,
   produced by `patches/expose-actions.patch` + the project's own Docker wasm stage, ~2 min incremental
   rebuild) directly in Node, attaches a hand-written HTTP byte-range `tileLoader` (the
   `Module.tileLoader` contract that `native/runtime.cpp`'s `EM_JS` bridges expect), initializes with the
   dataset config, and calls each additional `vb_*` action via emscripten `ccall` with Valhalla-native
   request JSON.

## Results matrix

| action              | exposed through shipped SDK? | reachable at all (0.2.1) | raw probe result | evidence |
| ------------------- | --- | --- | --- | --- |
| route               | yes (`route()`)               | yes | OK (both native and SDK-shaped requests; `route_sdk_shape`) | node/browser bench + caps-probe |
| isochrone           | **no**                        | yes, raw-only over patched wasm | OK (auto + truck `contours`) | caps-probe `"isochrone"` |
| matrix              | **no**                        | raw-only | OK (2 targets, ~86 ms warm) | caps-probe `"matrix"` |
| optimized_route     | **no**                        | raw-only | OK (3 stops, 16.9 KB output) | caps-probe `"optimized_route"` |
| trace_route (map matching) | **no**                 | raw-only | OK (97-sec polyline matched) | caps-probe `"trace_route"` |
| trace_attributes    | **no**                        | raw-only | OK (195.9 KB attrs) | caps-probe `"trace_attributes"` |
| locate              | **no**                        | raw-only | OK | caps-probe `"locate"` |
| status              | **no**                        | raw-only | OK | caps-probe `"status"` |

Also recorded:
- `loki.actions` in the dataset config is **`["route"]`** and `actor_t` construction throws
  `Action not supported <name>` for any action name absent from the list. The allowed names are
  the `Options.Action` proto enum names — notably the matrix action is `sources_to_targets` in the
  proto output, **not** `matrix` (options.proto lines 404-418). A dataset built for multi-action use
  needs those names added at `valhalla_build_config` time; our probe merged them at runtime.
- Raw costing validation is looser: a raw `route` with `costing: "motor_scooter"` succeeded
  (`route_unsupported_costing` OK), while the SDK layer rejects it with `UNSUPPORTED_COSTING`
  (`node-bench.json:behaviour.unsupportedCosting`). Do not rely on raw responses for validation.

## Work estimate to expose isochrone/matrix/optimized_route/map-matching through the SDK

Measured in this spike (one machine, 10 build jobs):
1. C++ bridge: ~30 LoC macro in `native/runtime.cpp` (`patches/expose-actions.patch`).
2. Widen `-sEXPORTED_FUNCTIONS` in `native/CMakeLists.txt` (same patch).
3. Incremental Docker wasm rebuild: **~2 minutes** (about 4 min for the first full 0.2.1 build).
4. SDK glue (follow-up work, not done here): request types + validation + response parsing in
   `valhalla-core/src/{protocol,profiles,engine}.ts`, worker protocol entries in
   `valhalla-server`, plus `loki.actions` widening in the dataset manifest pipeline for the
   release where this lands (a new release id would be needed anyway).
5. Total estimate: **1–2 focused days** of glue work; feasibility for every action is already
   proven by `results/caps-probe.json`.

## What failed or surprised us

- Node-benchmark `vb_route` parity: shipped SDK route and raw patched route agree exactly
  (38.393 km Mbabane→Manzini from both, `route_sdk_shape`).
- The dataset manifest's prepared `loki.actions: ["route"]` is the reason 0.2.1's map-matching and
  isochrone widening is a dataset-build choice as well as a code change — surfaced only when an
  unsupported action name throws at actor construction (captured via a temporarily instrumented
  `vb_init` before the debug print was removed).
