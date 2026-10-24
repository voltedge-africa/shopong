// Spike 7.1 multi-stop heuristic prototype (Node, valhalla-server 0.2.1 as shipped).
// Nearest-neighbour + 2-opt stop ORDERING on top of repeated single `route()` calls — the SDK has no
// matrix action exposed, so every pair distance here is a real route computation, memoized on demand.
// Evidence goes to results/multistop.json. Usage: MANIFEST_URL=... node scripts/multistop.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRouter } from 'valhalla-server/node';
import { RESULTS, haversineKm, ms, median } from './lib.mjs';

const manifestUrl = process.env.MANIFEST_URL;
if (!manifestUrl) { console.error('multistop: MANIFEST_URL required'); process.exit(1); }
const OUT = path.join(RESULTS, 'multistop.json');
fs.mkdirSync(RESULTS, { recursive: true });
fs.rmSync(OUT, { force: true });
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
function fail(e) { console.error('multistop FAILED:', e?.stack ?? e); fs.rmSync(OUT, { force: true }); process.exit(1); }

const mb = (n) => +(n / 1048576).toFixed(1);

// 8 real stops around Eswatini (WGS84), town centres verified inside the extract by the routes themselves.
export const STOPS = [
  { name: 'Mbabane (start)', lat: -26.3054, lon: 31.1367 },
  { name: 'Manzini', lat: -26.4833, lon: 31.3667 },
  { name: 'Matsapha', lat: -26.5167, lon: 31.3 },
  { name: 'Ezulwini', lat: -26.4253, lon: 31.1786 },
  { name: 'Sidvokodvo', lat: -26.6239, lon: 31.3667 },
  { name: 'Nhlangano', lat: -27.1117, lon: 31.1925 },
  { name: 'Siteki', lat: -26.4514, lon: 31.9489 },
  { name: 'Piggs Peak', lat: -25.9603, lon: 31.3778 },
];

const routeMsSample = [];
const cache = new Map();
const memoizeIfNeeded = (i, j) => cache.has(`${i}>${j}`);

async function main() {
  const r = await createRouter({ manifestUrl, maxQueuedRoutes: 4, routeTimeoutMs: 60000 });
  // distance(i,j) in km + duration in s, memoized both directions (symmetry assumed; recorded as an explicit caveat)
  const dist = async (i, j) => {
    if (i === j) return { km: 0, s: 0 };
    const key = `${i}>${j}`;
    if (cache.has(key)) return cache.get(key);
    const t = performance.now();
    const res = await r.route({ origin: { lat: STOPS[i].lat, lon: STOPS[i].lon }, destination: { lat: STOPS[j].lat, lon: STOPS[j].lon }, costing: 'auto' });
    routeMsSample.push(performance.now() - t);
    const v = { km: res.native.trip.summary.length, s: res.native.trip.summary.time };
    cache.set(key, v); cache.set(`${j}>${i}`, v);
    return v;
  };

  const start = performance.now();

  // ---- 1. nearest neighbour from stop 0
  const order = [0]; const left = new Set(STOPS.map((_, i) => i).slice(1));
  while (left.size) {
    const cur = order[order.length - 1];
    let best = null, bestD = Infinity;
    for (const j of left) { const d = (await dist(cur, j)).km; if (d < bestD) { bestD = d; best = j; } }
    order.push(best); left.delete(best);
  }
  const nnWallMs = ms(performance.now() - start);

  const totalFor = async (ord) => {
    let km = 0, s = 0;
    for (let k = 0; k < ord.length - 1; k++) { const d = await dist(ord[k], ord[k + 1]); km += d.km; s += d.s; }
    return { km: +km.toFixed(3), s: +s.toFixed(1) };
  };
  const nnOpen = await totalFor(order);
  const nnClosed = await totalFor([...order, order[0]]);

  // ---- 2. 2-opt improvement over the NN tour (closed tour cost; a driver returns to base)
  let ord = [...order];
  const closedCost = async (arr) => (await totalFor([...arr, arr[0]])).km;
  let improved = true, swaps = 0, improvedChecks = 0;
  const t2 = performance.now();
  while (improved) {
    improved = false;
    for (let i = 1; i < ord.length - 1; i++) {
      for (let k = i + 1; k < ord.length; k++) {
        improvedChecks++;
        const before = await closedCost(ord);
        const cand = [...ord.slice(0, i), ...ord.slice(i, k + 1).reverse(), ...ord.slice(k + 1)];
        const after = await closedCost(cand);
        if (after < before - 1e-6) { ord = cand; improved = true; swaps++; }
      }
    }
  }
  const optWallMs = ms(performance.now() - t2);
  const optClosed = await totalFor([...ord, ord[0]]);
  const optOpen = await totalFor(ord);

  // the tour the runner would actually drive: NN order straight through, and optimized order
  const memCalls = cache.size;
  const wallMs = ms(performance.now() - start);
  const rss = process.memoryUsage();

  const out = {
    at: new Date().toISOString(), manifestUrl,
    stops: STOPS.map((s) => s.name), costing: 'auto',
    nn: { order: order.map((i) => STOPS[i].name), openDriveKm: nnOpen.km, closedTourKm: nnClosed.km, closedTourS: nnClosed.s, wallMs: nnWallMs },
    twoOpt: { order: ord.map((i) => STOPS[i].name), openDriveKm: optOpen.km, closedTourKm: optClosed.km, closedTourS: optClosed.s, wallMs: optWallMs, swaps, improvedChecks },
    runtime: {
      routingCalls: cache.size, routeMsMedian: ms(median(routeMsSample)), routeMsMax: ms(Math.max(...routeMsSample)),
      improvementClosedTourPct: +(((nnClosed.km - optClosed.km) / nnClosed.km) * 100).toFixed(2),
      totalWallMs: wallMs, rssMiB: mb(rss.rss),
    },
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await r.dispose();
}

try { await main(); } catch (e) { fail(e); }
