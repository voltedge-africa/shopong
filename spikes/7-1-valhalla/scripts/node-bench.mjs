// Spike 7.1: valhalla-server 0.2.1 in Node. Needs the range server running (scripts/range-server.mjs).
// Usage: MANIFEST_URL=http://127.0.0.1:8090/datasets/<release>/manifest.json node scripts/node-bench.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRouter, Router } from 'valhalla-server/node';
import { PAIRS, TRUCK, RESULTS, shapeCheck, ms, median } from './lib.mjs';

const manifestUrl = process.env.MANIFEST_URL;
if (!manifestUrl) throw new Error('MANIFEST_URL required');
const out = { runtime: `node ${process.version}`, manifestUrl, at: new Date().toISOString(), routes: [], behaviour: {} };
const mb = (n) => +(n / 1048576).toFixed(1);
const snap = () => { const m = process.memoryUsage(); return { rssMiB: mb(m.rss), heapUsedMiB: mb(m.heapUsed), externalMiB: mb(m.external) }; };
const reqFor = (pair, costing) => ({ origin: pair.a, destination: pair.b, costing, ...(costing === 'truck' ? { costing_options: TRUCK } : {}) });
const errInfo = (e) => ({ name: e?.name, code: e?.code, message: e?.message, retryable: e?.retryable });

// ---- 1. startup (cold: fresh process-level worker thread, empty tile cache)
{
  const t0 = performance.now();
  const r = new Router({ manifestUrl });
  const startup = await r.initialize();
  out.startup = { wallMs: ms(performance.now() - t0), supportedCostings: startup.supportedCostings, release: startup.release,
    moduleStartupMs: startup.moduleStartupMs, graphStartupMs: startup.graphStartupMs, graphStartupRequests: startup.graphStartupRequests,
    graphStartupBytes: startup.graphStartupBytes, wasmMemory: startup.wasmMemory, memoryBudgetBytes: startup.memoryBudgetBytes,
    valhalla: startup.native.valhallaVersion, rssAfterStart: snap() };
  await r.dispose();
}

// ---- 2. per pair x costing: cold first route on a fresh router, then 5 warm repeats on the same router
for (const costing of ['auto', 'truck']) {
  for (const pair of PAIRS) {
    const r = new Router({ manifestUrl });
    await r.initialize();
    const rssBefore = snap();
    const cold = await r.route(reqFor(pair, costing));
    const warm = [];
    let last;
    for (let i = 0; i < 5; i++) { const t = performance.now(); last = await r.route(reqFor(pair, costing)); warm.push(performance.now() - t); }
    const d = await r.diagnostics();
    out.routes.push({
      pair: pair.name, costing,
      distanceKm: cold.native.trip.summary.length, timeS: cold.native.trip.summary.time,
      coldRouteMs: ms(cold.diagnostics.hostRouteMs), coldNativeMs: ms(cold.diagnostics.routeMs),
      coldTileDownloads: cold.diagnostics.loader.tileDownloads, coldRequests: cold.diagnostics.loader.requests, coldBytes: cold.diagnostics.loader.bytes,
      warmMedianMs: ms(median(warm)), warmMinMs: ms(Math.min(...warm)), warmMaxMs: ms(Math.max(...warm)),
      warmRepeatIdentical: JSON.stringify(last.native.trip.summary) === JSON.stringify(cold.native.trip.summary),
      wasmHeapCapacityHighWaterMiB: mb(d.native.wasmHeapCapacityHighWaterBytes), decodedCacheMiB: mb(d.native.decodedCacheBytes),
      totalTileDownloads: d.metrics.tileDownloads, totalBytes: d.metrics.bytes,
      rssBefore, rssAfter: snap(), shape: shapeCheck(cold.native),
      dataset: cold.dataset.release,
    });
    await r.dispose();
  }
}

// ---- 3. behaviour: one shared router
const r = new Router({ manifestUrl, maxQueuedRoutes: 3, queueTimeoutMs: 20000 });
await r.initialize();
const [p0, p1] = PAIRS;

// UNSUPPORTED_COSTING
try { await r.route({ origin: p0.a, destination: p0.b, costing: 'motor_scooter' }); out.behaviour.unsupportedCosting = 'NO ERROR'; }
catch (e) { out.behaviour.unsupportedCosting = errInfo(e); }
// invalid option
try { await r.route({ origin: p0.a, destination: p0.b, costing: 'truck', costing_options: { truck: { height: 99 } } }); out.behaviour.invalidTruckOption = 'NO ERROR'; }
catch (e) { out.behaviour.invalidTruckOption = errInfo(e); }
// intermediate stop (3 locations)
try { await r.route({ locations: [p0.a, p0.b, p1.b], costing: 'auto' }); out.behaviour.threeLocations = 'NO ERROR'; }
catch (e) { out.behaviour.threeLocations = errInfo(e); }
// outside coverage
try { await r.route({ origin: { lat: 51.5, lon: -0.12 }, destination: p0.b }); out.behaviour.outsideCoverage = 'NO ERROR'; }
catch (e) { out.behaviour.outsideCoverage = errInfo(e); }
// inside bbox, no road (Indian-ocean-side Mozambique corner of bbox is empty land; use a point in the extract bbox but outside Eswatini)
try { await r.route({ origin: { lat: -27.1, lon: 30.9 }, destination: p0.b }); out.behaviour.pointInSouthAfricaPartOfBbox = 'NO ERROR'; }
catch (e) { out.behaviour.pointInSouthAfricaPartOfBbox = errInfo(e); }

// concurrency: 5 requests at once; maxQueuedRoutes=3 means 1 active + 3 queued, 5th must fail QUEUE_FULL
{
  const t0 = performance.now();
  const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) =>
    r.route(reqFor(PAIRS[i % 3], 'auto')).then((x) => ({ i, doneAtMs: ms(performance.now() - t0), queueWaitMs: x.diagnostics.queueWaitMs, routeMs: x.diagnostics.routeMs }))));
  out.behaviour.concurrent5 = results.map((x, i) => x.status === 'fulfilled' ? x.value : { i, error: errInfo(x.reason) });
}

// cancel(): start route (cold on new pair via fresh router) and cancel after 1 ms
{
  const rc = new Router({ manifestUrl });
  await rc.initialize();
  const t0 = performance.now();
  const pending = rc.route(reqFor(PAIRS[0], 'auto')).then(() => 'completed', (e) => errInfo(e));
  await new Promise((res) => setTimeout(res, 1));
  const tc = performance.now();
  await rc.cancel();
  const cancelMs = performance.now() - tc;
  const outcome = await pending;
  const t1 = performance.now();
  let after;
  try { const x = await rc.route(reqFor(PAIRS[0], 'auto')); after = { ok: true, distanceKm: x.native.trip.summary.length, ms: ms(performance.now() - t1) }; }
  catch (e) { after = { ok: false, error: errInfo(e) }; }
  out.behaviour.cancel = { pendingOutcome: outcome, cancelAwaitMs: ms(cancelMs), routeAfterCancel: after, note: 'cancel terminates the worker thread; the decoded-tile cache is lost' };
  await rc.dispose();
}
// AbortSignal on one queued call leaves others intact
{
  const ra = new Router({ manifestUrl });
  await ra.initialize();
  const ac = new AbortController();
  const first = ra.route(reqFor(PAIRS[0], 'auto'));
  const queued = ra.route(reqFor(PAIRS[1], 'auto'), { signal: ac.signal }).then(() => 'completed', (e) => errInfo(e));
  const other = ra.route(reqFor(PAIRS[2], 'auto')).then(() => 'completed', (e) => errInfo(e));
  ac.abort();
  out.behaviour.abortQueued = { first: (await first).native.trip.summary.length, queued: await queued, other: await other };
  await ra.dispose();
}
const d = await r.diagnostics();
out.finalDiagnostics = { metrics: d.metrics, native: d.native, rss: snap() };
await r.dispose();

fs.mkdirSync(RESULTS, { recursive: true });
fs.writeFileSync(path.join(RESULTS, 'node-bench.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
