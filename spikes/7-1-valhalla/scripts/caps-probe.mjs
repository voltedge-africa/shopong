// Spike 7.1 capability probe, RAW layer. The shipped 0.2.1 npm binaries only export
// _vb_init/_vb_route/_vb_dispose/_vb_stats/_malloc/_free, so isochrone/matrix/optimized_route/
// trace_route/trace_attributes/locate/status are NOT callable through the SDK as shipped.
// This probe loads the SAME patched 0.2.1 runtime built from .cache/src/valhalla-wasm
// (native/runtime.cpp patch + rebuild, see patches/expose-actions.patch) and reaches the extra
// vb_* actions directly via emscripten ccall, with a hand-written tileLoader over HTTP ranges,
// mirroring what packages/valhalla-core/src/engine.ts sets up. Evidence goes to results/caps-probe.json.
// Usage: node scripts/caps-probe.mjs  (needs scripts/range-server.mjs running on :8090)
import fs from 'node:fs';
import path from 'node:path';
import { RESULTS, PLACES, PAIRS, ms } from './lib.mjs';

const BASE = 'http://127.0.0.1:8090';
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
const release = fs.readFileSync(path.join(REPO, '.cache', 'valhalla', 'RELEASE'), 'utf8').trim();
const patchedGlue = process.env.PATCHED_GLUE ?? path.join(REPO, '.cache/src/valhalla-wasm/public/wasm/valhalla.js');
const patchedWasm = patchedGlue.replace(/valhalla\.js$/, 'valhalla.wasm');
const OUT = path.join(RESULTS, 'caps-probe.json');
fs.mkdirSync(RESULTS, { recursive: true });
fs.rmSync(OUT, { force: true });
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
function fail(e) { console.error('caps-probe FAILED:', e?.stack ?? e); fs.rmSync(OUT, { force: true }); process.exit(1); }

// ---- hand-written tileLoader: HTTP byte ranges of graph.tar, mirroring the SDK TileLoader contract
// (get(url, offset, size) -> Uint8Array; objectSize/head must be synchronous, so size is precomputed).
const archiveUrl = `${BASE}/datasets/${release}/graph.tar`;
const archiveBytes = Number((await fetch(archiveUrl, { method: 'HEAD' })).headers.get('content-length'));
if (!archiveBytes) { fail(new Error(`no graph.tar at ${archiveUrl}`)); }

const tileLoader = {
  objectSize: () => archiveBytes,
  head: () => archiveBytes,
  async get(url, offset, size) {
    if (size > 0n) {
      const res = await fetch(url, { headers: { Range: `bytes=${offset}-${offset + size - 1n}` } });
      if (!res.ok) return null;
      return new Uint8Array(await res.arrayBuffer());
    }
    const res = await fetch(url); // size==0: whole document
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  },
};

// The 0.2.1 runtime glue is linked for ENVIRONMENT=shell; give it the two globals it needs in Node.
// It resolves "valhalla.wasm" against an empty scriptDirectory (= the glue's directory in practice).
globalThis.read = (f) => fs.readFileSync(path.resolve(path.dirname(patchedGlue), f));
globalThis.readbuffer = undefined;

// ---- boot the patched runtime the way valhalla-core does
const glue = await import(`file://${patchedGlue}`);
const wasmBinary = fs.readFileSync(patchedWasm);
const Module = await glue.default({
  wasmBinary,
  print: () => {},
  printErr: (t) => console.error('[wasm]', t),
});
Module.tileLoader = tileLoader;
const call = async (name, json) => Module.ccall(`vb_${name}`, 'string', json === undefined ? [] : ['string'], json === undefined ? [] : [JSON.stringify(json)], { async: true });

const results = { at: new Date().toISOString(), release, patchedGlue, archiveBytes, actions: {} };

// ---- dataset config, with the mjolnir/thor overrides Engine.initialize applies
const config = JSON.parse(await (await fetch(`${BASE}/datasets/${release}/config.json`)).text());
config.mjolnir.tile_url = archiveUrl;
config.mjolnir.max_cache_size = 32 * 1024 * 1024;
config.mjolnir.use_lru_mem_cache = true;
config.mjolnir.lru_mem_cache_hard_control = true;
config.mjolnir.global_synchronized_cache = false;
config.thor = { ...config.thor, max_reserved_labels_count_astar: 16384, max_reserved_labels_count_bidir_astar: 16384, clear_reserved_memory: true };
// keep service_defaults! actor_t ctor needs them; only widen the allowed actions list.
// NOTE: loki.actions entries must be exact Options.Action proto enum names — "matrix" is
// "sources_to_targets" in the proto (options.proto enum Action), and actor_t throws otherwise.
config.loki = { ...config.loki, actions: ['locate', 'route', 'sources_to_targets', 'optimized_route', 'isochrone', 'trace_route', 'trace_attributes', 'status'] };

const tI = performance.now();
const initRaw = await call('init', config);
results.init = { ms: ms(performance.now() - tI), raw: initRaw };
results.statsAfterInit = JSON.parse(await call('stats'));
if (results.init.raw.includes('runtimeError')) fail(new Error(`vb_init failed: ${initRaw}`));

// ---- probe each action with valhalla-native request JSON (not the SDK's NormalizedRequest shape)
const norm = (p) => ({ lat: p.lat, lon: p.lon, radius: 30, minimum_reachability: 0 });
const costingJson = (locations) => ({ locations, costing: 'auto', units: 'kilometers', language: 'en-US' });
const probe = async (name, req, key = name) => {
  try {
    const t = performance.now();
    const raw = String(await call(name, req));
    const out = { ms: ms(performance.now() - t), sizeBytes: raw.length };
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch { out.note = raw.slice(0, 160); }
    out.outcome = parsed === null ? 'NON_JSON'
      : parsed.nativeError !== undefined ? `NATIVE_ERROR_${parsed.nativeError}`
      : parsed.runtimeError !== undefined ? `RUNTIME_ERROR_${parsed.runtimeError}`
      : parsed.error_code !== undefined && parsed.error_code !== 0 ? `ERROR_CODE_${parsed.error_code}`
      : 'OK';
    if (parsed && out.outcome !== 'OK') {
      const s = JSON.stringify(parsed);
      out.firstError = s.length > 240 ? s.slice(0, 240) + '…' : s;
    }
    results.actions[key] = out;
    return parsed;
  } catch (e) { results.actions[key] = { outcome: 'JS_THROW', firstError: String(e).slice(0, 240) }; return null; }
};

await probe('status', {});
await probe('locate', costingJson([norm(PLACES.mbabane)]));
await probe('isochrone', { ...costingJson([norm(PLACES.manzini)]), contours: [{ time: 10 }], polygons: true, denoise: 0.1 });
await probe('matrix', { sources: [norm(PLACES.mbabane)], targets: [PLACES.manzini, PLACES.matsapha].map(norm), costing: 'auto', units: 'kilometers' });
await probe('optimized_route', { ...costingJson([PLACES.mbabane, PLACES.matsapha, PLACES.manzini].map(norm)) });
await probe('isochrone', { ...costingJson([norm(PLACES.matsapha)]), costing: 'truck', costing_options: { truck: { height: 4.2, width: 2.5, length: 12, weight: 18, axle_load: 8, hazmat: false } }, contours: [{ time: 5 }], polygons: true });

// trace_route/trace_attributes need a real shape: take trip.legs[0].shape from vb_route
const route = JSON.parse(await call('route', costingJson([norm(PAIRS[0].a), norm(PAIRS[1].b)])));
results.routeSanity = { legs: route.trip?.legs?.length, lengthKm: route.trip?.summary?.length };
const shape = route.trip?.legs?.[0]?.shape;
if (shape) {
  const traceReq = { encoded_polyline: shape, costing: 'auto', units: 'kilometers' };
  const tr = await probe('trace_route', traceReq);
  await probe('trace_attributes', traceReq);
  if (tr && tr.matched_points !== undefined) results.traceSanity = { matchedPoints: tr.matched_points };
} else {
  results.actions.trace_route = { outcome: 'SKIPPED_NO_SHAPE' };
  results.actions.trace_attributes = { outcome: 'SKIPPED_NO_SHAPE' };
}

// SDK-parity check: does raw route accept the SDK's NormalizedRequest shape too (locations w/ radius)?
await probe('route', costingJson([norm(PAIRS[0].a), norm(PAIRS[1].b)]), 'route_sdk_shape');
// unsupported costing at the raw layer (motor_scooter has no profile in 0.2.1)
await probe('route', { ...costingJson([norm(PAIRS[0].a), norm(PAIRS[1].b)]), costing: 'motor_scooter' }, 'route_unsupported_costing');

fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
