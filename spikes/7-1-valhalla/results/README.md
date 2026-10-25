# Spike 7.1 — Valhalla-WASM: routing from our own OSM tiles in Node and the browser

Branch: `spike/7-1-valhalla-tiles-routing`. Date: 2026-10-24. Everything in one place:
reproduce commands, the route benchmark table, tile-build cost, and pointers into the
detailed evidence docs (`capabilities.md`, `multistop.md`) and machine-readable
`*.json` results.

## What was run (not just analysed)

- Tile build from our own OSM extract (RUN, re-run twice to verify determinism of sizes; see note).
- Node benchmark (`valhalla-server` 0.2.1): 6 route scenarios + behaviour probes (RUN).
- Browser benchmark (`valhalla-browser` 0.2.1 in headless Chromium + CSP matrix) (RUN).
- Capability probe: 7 additional Valhalla actions via the patched runtime (RUN, see `capabilities.md`).
- Multi-stop NN + 2-opt heuristic over real route calls (RUN, see `multistop.md`).

## Reproduce

```sh
# 0. environment: Docker (image builds in step 1), Node >= 24, pnpm-installed spike deps
cd spikes/7-1-valhalla && pnpm install --ignore-workspace

# 1. native tools + wasm toolchain image + patched runtime (first build ~4 min, rebuild ~2 min)
bash scripts/01-build-native-tools.sh    # clones valhalla-wasm, checks out v0.2.1, builds the Docker image + native tools
git -C ../../.cache/src/valhalla-wasm apply spikes/7-1-valhalla/patches/expose-actions.patch
docker run --rm --user "$(id -u):$(id -g)" -e BUILD_JOBS=10 \
  -v "$(cd ../../.cache/src/valhalla-wasm && pwd):/work" -w /work valhalla-browser-build \
  bash scripts/build-container.sh wasm                                  # rebuilds public/wasm with the patch

# 2. tile build from the pinned extract (~8-11 s, 51 tiles, ODbL)
bash scripts/fetch-osm-extract.sh 2>/dev/null || true                   # see repo scripts/sandbox/fetch-osm-extract.sh
bash scripts/02-build-tiles.sh                                          # results/tile-build.json + RELEASE env

# 3. benchmarks (start the range server in another shell first)
node scripts/range-server.mjs &
REL=$(cat ../../.cache/valhalla/RELEASE)
MANIFEST_URL="http://127.0.0.1:8090/datasets/$REL/manifest.json" node scripts/node-bench.mjs
node scripts/browser-bench.mjs
MANIFEST_URL="http://127.0.0.1:8090/datasets/$REL/manifest.json" node scripts/multistop.mjs

# 4. capability probe (needs the patched wasm from step 1 and the range server)
node scripts/caps-probe.mjs
```

## Tile build numbers (pinned Geofabrik Eswatini extract, ~30 MB PBF)

| metric | value |
| --- | --- |
| dataset release | `eswatini-2026-10-23-ee64eeb3ddec4d64` |
| native builder | valhalla 3.8.3 (pinned rev `a60c7cbf…`, sha-pinned in manifest) |
| tiles | **51** (`audit.tiles`, all with timezone; 105 760 / 106 878 nodes with country) |
| graph.tar | **22 138 880 bytes** (21.1 MiB), one tar, byte-range indexed in manifest (11 422 B) |
| tile-build wall | **7.9 s** (threads=4; 11.1 s on the first run with 8 threads) |
| SDK costings advertised | auto, bicycle, pedestrian, truck |
| coverage | 30.7858, -27.3183 … 32.1370, -25.7178 (extract bbox) |

Re-run note: a second build of the same PBF produced the same tile/sha audit but a **different release id**
(`…9417c9f2…` → `…ee64eeb3…`), because the baked `nativeConfigSha256` covers a `tile_url` that embeds the
release path itself, so the build is not byte-reproducible by release id. Sizes and contract behaviour were identical.

## Route table (Node, auto costing; truck results in `node-bench.json`)

| pair | km | min (drive s) | cold route ms | tiles fetched (bytes) | warm median ms (of 5) | identical repeats |
| --- | --- | --- | --- | --- | --- | --- |
| Mbabane → Manzini | 38.393 | 24.3 | 434 | 5 (7.38 MB) | 37.4 | yes |
| Manzini → Matsapha | 10.419 | 13.3 | 591 | 8 (9.72 MB) | 58.7 | yes |
| Mbabane urban hop | 2.898 | 3.6 | 467 | 3 (4.40 MB) | 12.3 | yes |

Browser (`valhalla-browser`, headless Chromium): same distances/times; startup 246 ms wall
(module 147.6 ms + graph 69.6 ms, 6 requests, 23.5 KB); first cold route 566.4 ms, warm median
44.3 ms; Chromium tree peak RSS 764 MiB, main-thread JS heap 2.4 MiB. Wasm memory: 128 MiB
initial / 512 MiB max in browser, 256 MiB initial in Node.

### Behaviour probes (Node; full details in `node-bench.json:behaviour`)

| probe | result |
| --- | --- |
| unsupported costing (`motor_scooter`) | `UNSUPPORTED_COSTING` before any native call; supported list auto/bicycle/pedestrian/truck |
| invalid truck option (`height: 99`) | `INVALID_REQUEST` ("must be a finite number from 0 to 10") |
| 3 locations (waypoint) | `INVALID_REQUEST` ("Exactly two locations are required") |
| outside coverage (London) | `OUTSIDE_COVERAGE` |
| point in extract bbox but in South Africa | **NO ERROR** → routed (bbox is a rectangle; coverage is bbox, not the border) |
| 5 concurrent calls (queue=3) | 4 complete (54.5 / 128.6 / 139.3 / 179 ms), 5th rejects `QUEUE_FULL` |
| `cancel()` mid-route | pending rejects `CANCELLED` in 2.8 ms; next route re-inits thread + tiles (525.1 ms, cache lost) |
| `AbortSignal` on queued call | only the aborted one rejects; active + other queued calls complete |

## Documents and files

| file | content |
| --- | --- |
| `results/node-bench.json` | Node runtime numbers + behaviour probes |
| `results/browser-bench.json` | Chromium numbers + 9-case CSP matrix (5 pass unprotected by default; worker/wasm from CDN origin needs `worker-src 'self' blob: {B}` or no CSP) |
| `results/capabilities.md` + `caps-probe.json` | which actions are exposed vs raw-only, with the runtime patch applied (`patches/expose-actions.patch`) |
| `results/multistop.md` + `multistop.json` | 8-stop NN + 2-opt over real route calls |
| `results/tile-build.json` + `tile-build.log` | tile build numbers, determinism audit |
| `patches/expose-actions.patch` | the 30-LoC native change that exposes the other tyr actions |
