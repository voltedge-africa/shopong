# Spike 7.1 multi-stop heuristic: nearest-neighbour + 2-opt over repeated single routes

Date: 2026-10-24. Node 24, `valhalla-server` 0.2.1 as shipped (route action only — there is no
exposed matrix action, see `capabilities.md`), auto costing, 8 real Eswatini stops.
Script: `scripts/multistop.mjs`. Machine-readable evidence: `results/multistop.json`.

## Approach

1. Stop order starts with nearest-neighbour from the depot (Mbabane), picking the next stop by the
   **real routed distance** of the candidate leg (not straight-line).
2. 2-opt then improves the closed tour, re-scoring candidate swaps with **real routed distances**.
3. Every pair distance is a genuine `Router.route()` call, memoized symmetrically on demand
   (an explicit simplification; one-direction lookups are reused in reverse).

## Result (8 stops, warm router)

| metric | value |
| --- | --- |
| stops | Mbabane (start), Manzini, Matsapha, Ezulwini, Sidvokodvo, Nhlangano, Siteki, Piggs Peak |
| NN order | Mbabane → Ezulwini → Matsapha → Manzini → Sidvokodvo → Nhlangano → Siteki → Piggs Peak |
| NN closed tour | 540.242 km (29 780.9 s drive) |
| 2-opt order | Mbabane → Ezulwini → Matsapha → Nhlangano → Sidvokodvo → Manzini → Siteki → Piggs Peak |
| 2-opt closed tour | 536.122 km (29 552.8 s drive) |
| 2-opt improvement | **0.76 %** (1 swap, 42 candidate checks) |
| open delivery legs (no return) | NN 451.276 km → 2-opt 447.156 km |
| routing `route()` calls made | 56 (one warm-up pair + 55 memoized fills) |
| warm route latency, median / max | 32.5 ms / 482.2 ms (first touch of a new tile triggers cold fetches) |
| total wall (NN + 2-opt + fills) | **1 595 ms** |
| Node RSS after | 418.9 MiB |

## Reading

- On this road network NN is already near-optimal: one 2-opt swap (pulling Nhlangano before
  Sidvokodvo/Manzini) gains under 1 %. The heuristic is cheap to run server-side.
- The cost driver is **pair routing, not the optimizer**: 2-opt scoring was effectively free
  (0.7 ms) once distances were memoized; 56 warm/semi-warm routes took ~1.6 s.
- For a real 8-stop delivery, the SDK-only path (no matrix exposure) is therefore viable: a
  depot round costs roughly one route call per distinct pair touched (~1-2 s at warm-cache
  latencies on a country-size dataset). If `sources_to_targets` (matrix) were exposed through the
  SDK, the matrix for 8 stops would replace those pairwise routes with a single native call —
  see `capabilities.md` for the estimate.
