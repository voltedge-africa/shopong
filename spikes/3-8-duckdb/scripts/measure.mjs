// Measurement driver for spike 3.8 phase 1.
// Runs the whole pipeline N times (default 3) and writes results/measurements.json (median+spread)
// plus results/measurements-run<i>.json. FAILS LOUDLY: every failed step is collected and printed,
// then the process exits non-zero. Also fails on any page error, CSP violation or third-party fetch.
import { startServer } from "./server.mjs";
import { launch } from "./lib.mjs";
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import zlib from "node:zlib";

const RUNS = Number(process.argv[2] ?? process.env.RUNS ?? 3);
const alias = process.env.DUCKDB_ALIAS ?? "duckdb-1.32.0";
const shim = process.env.ARROW_SHIM !== "0";
const dir = `.tmp/dist-${alias}${shim ? "-shim" : ""}`;

// The five timed queries (the `month`-alias bug from the earlier run is worked around with `mon`,
// and asserted below: date_trunc month grouping must return rows).
const QUERIES = {
  spend_per_item: "select item, count(*) n, sum(qty*price_cents)/100.0 rand from orders group by 1 order by 3 desc",
  who_has_not_paid:
    "select m.member_id, count(*) unpaid from members m join pledges p using(member_id) where p.cycle = 11 and not p.paid group by 1 order by 2 desc, 1 limit 20",
  delivery_hours_per_point:
    "select collection_point, count(*) n, avg(delivered_ms - dispatched_ms)/3600000.0 avg_hours from deliveries where status='delivered' group by 1 order by 1",
  price_history_by_month:
    // ts_ms is UBIGINT; make_timestamp needs BIGINT. Cast keeps date_trunc off the ICU-dependent
    // TIMESTAMPTZ path (that path autoloads icu from the CDN and fails under strict CSP).
    "select item, date_trunc('month', make_timestamp(ts_ms::BIGINT * 1000)) as mon, avg(price_cents)/100.0 avg_price from orders group by 1,2 order by 1,2",
  three_way_join:
    "select d.collection_point, count(distinct m.member_id) members, sum(o.qty*o.price_cents)/100.0 total_value from deliveries d join orders o using(order_id) join members m using(member_id) group by 1 order by 1",
};
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const p50 = (x) => median(Object.values(x));
const spread = (xs, key) => {
  const vals = xs.map((x) => Number(x?.[key] ?? x)).filter((v) => Number.isFinite(v));
  return { minMs: Math.min(...vals), maxMs: Math.max(...vals) };
};

function bundleSizes() {
  const out = {};
  const files = readdirSync(join(dir, "duckdb"));
  for (const f of files) {
    const raw = readFileSync(join(dir, "duckdb", f));
    out[f] = { raw: raw.length, gzip: zlib.gzipSync(raw, { level: 9 }).length };
  }
  for (const f of readdirSync(join(dir, "assets"))) {
    const raw = readFileSync(join(dir, "assets", f));
    out["app/" + f] = { raw: raw.length, gzip: zlib.gzipSync(raw, { level: 9 }).length };
  }
  out["index.html"] = { raw: held().length, gzip: zlib.gzipSync(held(), { level: 9 }).length };
  return out;
}
function held() {
  return readFileSync(join(dir, "index.html"));
}

/* ---------------- one measurement run ---------------- */
async function oneRun(n) {
  const errors = [];
  const fatal = (m) => errors.push(m);
  const step = async (name, f) => {
    try {
      return await f();
    } catch (e) {
      fatal(`run ${n} step ${name}: ${String(e?.message ?? e).split("\n")[0].slice(0, 500)}`);
      return null;
    }
  };
  const run = { n, alias, engine: null };

  const srv = await startServer({ dir, csp: "strict", extDir: "ext-mirror", cacheControl: "no-store" });
  const browser = await launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => fatal(`run ${n} pageerror: ${String(e.message).slice(0, 300)}`));
  page.on("request", (r) => {
    if (!r.url().startsWith(srv.url) && !r.url().startsWith("data:") && !r.url().startsWith("blob:"))
      fatal(`run ${n} THIRD-PARTY REQUEST to ${r.url()}`);
  });
  // Block all third parties in the harness too (belt and braces with strict CSP).
  await page.route("**/*", (r) => (r.request().url().startsWith(srv.url) ? r.continue() : r.abort()));

  // Heap sampler (Chromium-only performance.memory) started on every document.
  await ctx.addInitScript(() => {
    window.__heapPeak = 0;
    window.__heapStart = performance?.memory?.usedJSHeapSize ?? -1;
    setInterval(() => {
      const u = performance?.memory?.usedJSHeapSize ?? 0;
      if (u > window.__heapPeak) window.__heapPeak = u;
    }, 50);
  });

  const t0 = Date.now();
  await step("goto", () => page.goto(srv.url, { timeout: 30000 }));
  await step("ready", () => page.waitForFunction(() => window.spikeReady, null, { timeout: 30000 }));
  const init = await step("init", () => page.evaluate(() => window.spike.init()));
  if (init) {
    run.coldStartMs = Date.now() - t0; // nav -> spikeReady -> AsyncDuckDB instantiated + connected
    run.instantiateMs = init.instantiateMs;
    run.bundle = init.bundle;
    run.engine = init.version?.v;
    run.crossOriginIsolated = init.crossOriginIsolated;
  } else return finish();

  run.sizes = bundleSizes();

  const loadAt = async (total, format) => {
    const r = await step(`load_${total}_${format}`, () => page.evaluate(([t, f]) => window.spike.load(t, f), [total, format]));
    if (!r) return null;
    const expect = {
      10000: { members: 500, orders: 4000, pledges: 4000, deliveries: 1500 },
      200000: { members: 10000, orders: 80000, pledges: 80000, deliveries: 30000 },
    }[total];
    for (const [k, v] of Object.entries(expect)) if (r.counts[k] !== v) fatal(`run ${n} load_${total}_${format}: ${k} count ${r.counts[k]} != ${v}`);
    return { totalMs: r.totalMs, perTableMs: r.times, genMs: r.genMs, counts: r.counts };
  };

  run.load10k = { json: await loadAt(10000, "json"), arrow: await loadAt(10000, "arrow") };
  run.load200k = { arrow: await loadAt(200000, "arrow") };

  const timedQueries = async (label) => {
    const reps = 5;
    const out = {};
    for (const [name, sql] of Object.entries(QUERIES)) {
      const ms = [];
      let rows;
      for (let i = 0; i < reps; i++) {
        const r = await step(`q_${label}_${name}_${i}`, () => page.evaluate((s) => window.spike.query(s), sql));
        if (!r) break;
        ms.push(r.ms);
        rows = r.value;
      }
      if (ms.length === reps) {
        const rowsSeen = rows.length;
        if (rowsSeen === 0) fatal(`run ${n} ${label} ${name}: query returned 0 rows`);
        if (name === "price_history_by_month" && rowsSeen < 12) fatal(`run ${n} ${label} price_history_by_month: month grouping produced ${rowsSeen} rows (<12)`);
        out[name] = { medianMs: median(ms), minMs: Math.min(...ms), rows: rowsSeen };
      }
    }
    return out;
  };
  // reload fresh data per scale so the 10k numbers are on 10k-only tables
  await loadAt(10000, "arrow");
  run.latency10k = await timedQueries("10k");
  await loadAt(200000, "arrow");
  run.latency200k = await timedQueries("200k");

  // spatial (on the 200k dataset), from the self-hosted /ext repo, strict CSP
  const repo = `${srv.url}/ext`;
  await step("spatial_setup", () =>
    page.evaluate((u) => window.spike.script([`SET custom_extension_repository='${u}'`, "SET autoload_known_extensions=false", "SET autoinstall_known_extensions=false"]), repo));
  const startExtLog = srv.log.length;
  const sp = await step("spatial_checks", () => page.evaluate((u) => window.spike.spatial({ customRepo: u }), repo));
  const srvExtLog = srv.log.slice(startExtLog).filter((l) => l.ext);
  if (sp) {
    const checks = {};
    const entries = (sp.checks ?? []).map((r, i) => [sp.checkNames?.[i] ?? `check${i}`, r]);
    for (const [name, r] of entries) checks[name] = { ok: !r.error, error: r.error ?? null, value: r.rows?.[0] ?? null };
    run.spatial = {
      install: sp.install?.value,
      load: sp.load?.value,
      checks,
      extensionTransferBytes: Object.fromEntries(srvExtLog.map((l) => [l.path.split("/").slice(-2).join("/"), { raw: l.bytes, wire: l.transfer, enc: l.enc }])),
      extensionsLoaded: (sp.extensions ?? []).map((e) => e.extension_name),
    };
  }

  run.peakJSHeapMb = Math.round(((await page.evaluate(() => window.__heapPeak)) ?? 0) / (1024 * 1024));
  run.heapStartMb = Math.round(((await page.evaluate(() => window.__heapStart)) ?? 0) / (1024 * 1024));

  async function finish() {
    await browser.close();
    await srv.close();
  }
  await finish();
  run.stepErrors = errors;
  mkdirSync("results", { recursive: true });
  writeFileSync(`results/measurements-run${n}.json`, JSON.stringify(run, null, 2) + "\n");
  return run;
}

/* ---------------- main ---------------- */
const runs = [];
for (let i = 1; i <= RUNS; i++) runs.push(await oneRun(i));

const fail = runs.flatMap((r) => r.stepErrors);
const summary = {
  capturedAt: new Date().toISOString(),
  alias,
  engine: runs[0]?.engine,
  runs,
  median: {},
};
if (fail.length === 0) {
  const ct = runs.map((r) => r.coldStartMs);
  summary.median.coldStartMs = median(ct);
  summary.median.spread = { minMs: Math.min(...ct), maxMs: Math.max(...ct) };
  for (const label of ["latency10k", "latency200k"]) {
    summary.median[label] = {};
    for (const q of Object.keys(QUERIES)) {
      const ms = runs.map((r) => r[label]?.[q]?.medianMs).filter(Number.isFinite);
      summary.median[label][q] = ms.length === runs.length ? { medianMs: median(ms), minMs: Math.min(...ms), maxMs: Math.max(...ms) } : { error: "missing in some runs" };
    }
  }
  const loads10k = runs.map((r) => r.load10k?.arrow?.totalMs).filter(Number.isFinite);
  const loads200k = runs.map((r) => r.load200k?.arrow?.totalMs).filter(Number.isFinite);
  summary.median.load10kArrowTotalMs = { medianMs: median(loads10k), minMs: Math.min(...loads10k), maxMs: Math.max(...loads10k) };
  summary.median.load200kArrowTotalMs = { medianMs: median(loads200k), minMs: Math.min(...loads200k), maxMs: Math.max(...loads200k) };
  const heap = runs.map((r) => r.peakJSHeapMb).filter(Number.isFinite);
  summary.median.peakJSHeapMb = { medianMb: median(heap), minMb: Math.min(...heap), maxMb: Math.max(...heap) };
}
writeFileSync("results/measurements.json", JSON.stringify(summary, null, 2) + "\n");

if (fail.length) {
  console.error("\n=== MEASUREMENT FAILED — " + fail.length + " error(s) ===");
  for (const e of fail) console.error("  " + e);
  console.error("Partial results in results/measurements.json / measurements-run*.json");
  process.exit(1);
}
console.log("OK median coldStartMs=" + summary.median.coldStartMs,
  "10k=" + JSON.stringify(summary.median.latency10k),
  "200k=" + JSON.stringify(summary.median.latency200k),
  "heap=" + JSON.stringify(summary.median.peakJSHeapMb));
