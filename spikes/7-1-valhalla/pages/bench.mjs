// Runs inside headless Chromium. Same scenarios as scripts/node-bench.mjs, using valhalla-browser.
// Query: ?manifest=<url>&mode=full|csp
import { Router, RoutingError } from '/sdk/index.js';
import { PAIRS, TRUCK, decodePolyline6, polylineLengthKm } from '/pages/shared.mjs';

const q = new URLSearchParams(location.search);
const manifestUrl = q.get('manifest');
const mode = q.get('mode') ?? 'full';
const out = { userAgent: navigator.userAgent, crossOriginIsolated, manifestUrl, routes: [], behaviour: {} };
const mb = (n) => +(n / 1048576).toFixed(1);
const ms = (n) => +n.toFixed(1);
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const errInfo = (e) => ({ name: e?.name, code: e?.code, message: e?.message, retryable: e?.retryable });
const reqFor = (pair, costing) => ({ origin: pair.a, destination: pair.b, costing, ...(costing === 'truck' ? { costing_options: TRUCK } : {}) });
const shape = (native) => {
  const pts = native.trip.legs.flatMap((l) => decodePolyline6(l.shape));
  const g = polylineLengthKm(pts);
  return { points: pts.length, geomKm: +g.toFixed(3), reportedKm: native.trip.summary.length, ratio: +(g / native.trip.summary.length).toFixed(4) };
};

async function run() {
  if (mode === 'csp') {
    // Strict-CSP probe: just try to route once; success/failure and CSP violations are collected by the harness.
    const opts = { manifestUrl };
    if (q.get('workerUrl')) opts.workerUrl = q.get('workerUrl');
    if (q.get('wasmUrl')) opts.wasmUrl = q.get('wasmUrl');
    const r = new Router(opts);
    try {
      const x = await r.route(reqFor(PAIRS[0], 'auto'));
      out.csp = { ok: true, distanceKm: x.native.trip.summary.length };
    } catch (e) { out.csp = { ok: false, error: errInfo(e) }; }
    await r.dispose();
    return;
  }
  {
    const t0 = performance.now();
    const r = new Router({ manifestUrl });
    const s = await r.initialize();
    out.startup = { wallMs: ms(performance.now() - t0), workerReadyMs: ms(s.workerReadyMs), moduleStartupMs: ms(s.moduleStartupMs), graphStartupMs: ms(s.graphStartupMs),
      graphStartupRequests: s.graphStartupRequests, graphStartupBytes: s.graphStartupBytes, supportedCostings: s.supportedCostings, wasmMemory: s.wasmMemory,
      memoryBudgetBytes: s.memoryBudgetBytes, valhalla: s.native.valhallaVersion };
    await r.dispose();
  }
  for (const costing of ['auto', 'truck']) {
    for (const pair of PAIRS) {
      const r = new Router({ manifestUrl });
      await r.initialize();
      const cold = await r.route(reqFor(pair, costing));
      const warm = []; let last;
      for (let i = 0; i < 5; i++) { const t = performance.now(); last = await r.route(reqFor(pair, costing)); warm.push(performance.now() - t); }
      const d = await r.diagnostics();
      out.routes.push({ pair: pair.name, costing, distanceKm: cold.native.trip.summary.length, timeS: cold.native.trip.summary.time,
        coldRouteMs: ms(cold.diagnostics.hostRouteMs), coldNativeMs: ms(cold.diagnostics.routeMs),
        coldTileDownloads: cold.diagnostics.loader.tileDownloads, coldRequests: cold.diagnostics.loader.requests, coldBytes: cold.diagnostics.loader.bytes,
        warmMedianMs: ms(median(warm)), warmMinMs: ms(Math.min(...warm)), warmMaxMs: ms(Math.max(...warm)),
        warmRepeatIdentical: JSON.stringify(last.native.trip.summary) === JSON.stringify(cold.native.trip.summary),
        wasmHeapCapacityHighWaterMiB: mb(d.native.wasmHeapCapacityHighWaterBytes), decodedCacheMiB: mb(d.native.decodedCacheBytes),
        totalTileDownloads: d.metrics.tileDownloads, totalBytes: d.metrics.bytes, shape: shape(cold.native) });
      await r.dispose();
    }
  }
  const [p0, p1] = PAIRS;
  const r = new Router({ manifestUrl });
  await r.initialize();
  for (const [key, req] of Object.entries({
    unsupportedCosting: { origin: p0.a, destination: p0.b, costing: 'motor_scooter' },
    invalidTruckOption: { origin: p0.a, destination: p0.b, costing: 'truck', costing_options: { truck: { height: 99 } } },
    threeLocations: { locations: [p0.a, p0.b, p1.b], costing: 'auto' },
    outsideCoverage: { origin: { lat: 51.5, lon: -0.12 }, destination: p0.b },
    pointInSouthAfricaPartOfBbox: { origin: { lat: -27.1, lon: 30.9 }, destination: p0.b },
  })) {
    try { await r.route(req); out.behaviour[key] = 'NO ERROR'; } catch (e) { out.behaviour[key] = errInfo(e); }
  }
  {
    const t0 = performance.now();
    const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) =>
      r.route(reqFor(PAIRS[i % 3], 'auto')).then((x) => ({ i, doneAtMs: ms(performance.now() - t0), routeMs: ms(x.diagnostics.routeMs), hostRouteMs: ms(x.diagnostics.hostRouteMs) }))));
    out.behaviour.concurrent5 = results.map((x, i) => x.status === 'fulfilled' ? x.value : { i, error: errInfo(x.reason) });
  }
  {
    // cancel(): rejects ALL pending (including queued) and drops the worker + tile cache
    const rc = new Router({ manifestUrl });
    await rc.initialize();
    const a = rc.route(reqFor(PAIRS[0], 'auto')).then(() => 'completed', (e) => errInfo(e));
    const b = rc.route(reqFor(PAIRS[1], 'auto')).then(() => 'completed', (e) => errInfo(e));
    await new Promise((res) => setTimeout(res, 1));
    rc.cancel();
    const outcome = { active: await a, queued: await b };
    const t1 = performance.now();
    let after;
    try { const x = await rc.route(reqFor(PAIRS[0], 'auto')); after = { ok: true, distanceKm: x.native.trip.summary.length, ms: ms(performance.now() - t1) }; }
    catch (e) { after = { ok: false, error: errInfo(e) }; }
    out.behaviour.cancel = { outcome, routeAfterCancel: after };
    await rc.dispose();
  }
  for (const [label, delayMs] of [['abortImmediately', 0], ['abortAfter20ms', 20]]) {
    // AbortSignal on one route(): the SDK terminates the worker and rejects every pending call, not just that one
    const ra = new Router({ manifestUrl });
    await ra.initialize();
    const ac = new AbortController();
    const a = ra.route(reqFor(PAIRS[0], 'auto')).then(() => 'completed', (e) => errInfo(e));
    const b = ra.route(reqFor(PAIRS[1], 'auto'), { signal: ac.signal }).then(() => 'completed', (e) => errInfo(e));
    const c = ra.route(reqFor(PAIRS[2], 'auto')).then(() => 'completed', (e) => errInfo(e));
    if (delayMs) await new Promise((res) => setTimeout(res, delayMs));
    ac.abort();
    out.behaviour[label] = { first: await a, abortedOne: await b, other: await c };
    await ra.dispose();
  }
  const d = await r.diagnostics();
  out.finalDiagnostics = { metrics: d.metrics, native: d.native, traceEntries: d.trace.length, resourceTimingEntries: d.resourceTiming.length };
  await r.dispose();
}
try { await run(); } catch (e) { out.fatal = errInfo(e); out.fatalStack = String(e?.stack ?? e); }
window.__result = out;
