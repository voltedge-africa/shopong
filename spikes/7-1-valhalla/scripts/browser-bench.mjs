// Spike 7.1: valhalla-browser 0.2.1 in headless Chromium (Playwright). Starts its own range server.
// Usage: node scripts/browser-bench.mjs [releaseId]   (defaults to .cache/valhalla/RELEASE)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { createServer, listen } from './range-server.mjs';
import { CACHE, RESULTS } from './lib.mjs';

const release = process.argv[2] ?? fs.readFileSync(path.join(CACHE, 'valhalla', 'RELEASE'), 'utf8').trim();
const OUT = path.join(RESULTS, 'browser-bench.json');
fs.mkdirSync(RESULTS, { recursive: true });
fs.rmSync(OUT, { force: true }); // no stale results survive a failed run
const _fail = (e) => { console.error('browser-bench FAILED:', e?.stack ?? e); fs.rmSync(OUT, { force: true }); process.exit(1); };
process.on('uncaughtException', _fail);
process.on('unhandledRejection', _fail);
const log = [];
const server = createServer({ log });
const port = await listen(server, 0);
const base = `http://127.0.0.1:${port}`;
const manifest = `${base}/datasets/${release}/manifest.json`;

/** Sum RSS (MiB) of every Chromium process reported by CDP SystemInfo.getProcessInfo (browser, renderer, gpu, utility). */
async function chromiumRssMiB(browserCdp) {
  const { processInfo } = await browserCdp.send('SystemInfo.getProcessInfo');
  let kb = 0;
  for (const p of processInfo) { try { kb += Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${p.id}/status`, 'utf8'))?.[1] ?? 0); } catch { /* gone */ } }
  return +(kb / 1024).toFixed(1);
}

const out = { at: new Date().toISOString(), release, main: null, csp: {} };

async function withPage(url, { csp } = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const violations = [];
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.goto(url);
  return { browser, page, cdp, violations, consoleErrors };
}

// ---- main benchmark
{
  const { browser, page, cdp, consoleErrors } = await withPage(`${base}/pages/bench.html?mode=full&manifest=${encodeURIComponent(manifest)}`);
  const bcdp = await browser.newBrowserCDPSession();
  let peakRss = 0;
  const sampler = setInterval(async () => { try { peakRss = Math.max(peakRss, await chromiumRssMiB(bcdp)); } catch { /* closing */ } }, 100);
  await page.waitForFunction(() => window.__result, null, { timeout: 300000 });
  clearInterval(sampler);
  const result = await page.evaluate(() => window.__result);
  const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  result.process = { chromiumTreePeakRssMiB: peakRss, chromiumTreeRssAtEndMiB: await chromiumRssMiB(bcdp), mainThreadJSHeapUsedMiB: +(metrics.JSHeapUsedSize / 1048576).toFixed(1) };
  result.consoleErrors = consoleErrors;
  out.main = result;
  await browser.close();
}
out.serverRequests = { total: log.length, ranges206: log.filter((l) => l.status === 206).length, full200: log.filter((l) => l.status === 200).length,
  tarRangeBytes: log.filter((l) => l.path.endsWith('graph.tar')).reduce((a, l) => a + l.bytes, 0) };

// ---- CSP probes. Two servers: A serves the page (+ SDK) with the CSP, B is a "CDN" (tiles, optionally SDK worker/wasm).
// {A} {B} are replaced with the real origins. `localhost` vs `127.0.0.1` makes A and B different origins.
const cases = [
  { label: 'no CSP (baseline)', csp: null, tilesOn: 'A' },
  { label: "default-src 'none'; script 'self'; worker 'self'; connect 'self' (NO wasm-unsafe-eval)", csp: "default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'self'", tilesOn: 'A' },
  { label: "same + script-src 'wasm-unsafe-eval'", csp: "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'", tilesOn: 'A' },
  { label: "same + wasm-unsafe-eval, tiles on another origin, connect-src NOT listing it", csp: "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'", tilesOn: 'B' },
  { label: "same + wasm-unsafe-eval, tiles on another origin, connect-src {B}", csp: "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self' {B}", tilesOn: 'B' },
  { label: "worker+wasm on CDN origin B, NO CSP", csp: null, tilesOn: 'B', cdnWorker: true },
  { label: "worker+wasm on CDN origin B, worker-src 'self' only (no blob:)", csp: "default-src 'none'; script-src 'self' {B} 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self' {B}", tilesOn: 'B', cdnWorker: true },
  { label: "worker+wasm on CDN origin B, worker-src 'self' blob: (B not listed)", csp: "default-src 'none'; script-src 'self' {B} 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' {B}", tilesOn: 'B', cdnWorker: true },
  { label: "worker+wasm on CDN origin B, worker-src 'self' blob: {B}", csp: "default-src 'none'; script-src 'self' {B} 'wasm-unsafe-eval'; worker-src 'self' blob: {B}; connect-src 'self' {B}", tilesOn: 'B', cdnWorker: true },
];
for (const c of cases) {
  const logs = [];
  const srvB = createServer({ log: logs });
  const pB = await listen(srvB, 0);
  const originB = `http://localhost:${pB}`;
  const placeholder = (t) => t?.replaceAll('{B}', originB) ?? undefined;
  const srvA = createServer({ csp: placeholder(c.csp), log: logs });
  const pA = await listen(srvA, 0);
  const originA = `http://127.0.0.1:${pA}`;
  const tiles = c.tilesOn === 'B' ? originB : originA;
  const params = new URLSearchParams({ mode: 'csp', manifest: `${tiles}/datasets/${release}/manifest.json` });
  if (c.cdnWorker) { params.set('workerUrl', `${originB}/sdk/worker.js`); params.set('wasmUrl', `${originB}/sdk/valhalla-browser.wasm`); }
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  const messages = [];
  page.on('pageerror', (x) => messages.push('pageerror: ' + String(x).slice(0, 200)));
  page.on('console', (x) => { if (['error', 'warning'].includes(x.type())) messages.push(x.text().replace(/\s+/g, ' ').slice(0, 220)); });
  await page.goto(`${originA}/pages/bench.html?${params}`);
  await page.waitForFunction(() => window.__result, null, { timeout: 30000 }).catch(() => {});
  const r = await page.evaluate(() => window.__result?.csp ?? 'no result (page script blocked or hung)');
  out.csp[c.label] = { policy: placeholder(c.csp) ?? '(none)', result: r, consoleMessages: [...new Set(messages)].slice(0, 3) };
  await browser.close();
  srvA.close(); srvB.close();
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(0);
