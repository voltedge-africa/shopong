// Extension sovereignty test: which URLs does the loader hit, can it be self-hosted, does it work
// with every third party blocked, what happens with the autoloader and offline.
import { startServer, CSP } from "./server.mjs";
import { launch, trackRequests, save } from "./lib.mjs";

const alias = process.argv[2] ?? "duckdb-dev65";
const version = process.argv[3] ?? "v1.5.6";
const dir = `.tmp/dist-${alias}`;
const results = { alias, version, scenarios: {} };

async function scenario(name, { csp = "none", blockThirdParty = false, customRepo = false, preSql = [], steps, offlineAfterFirst = false }) {
  const srv = await startServer({ dir, csp, extDir: "ext-mirror" });
  const browser = await launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const blocked = [];
  if (blockThirdParty) {
    await page.route("**/*", (route) => {
      const u = route.request().url();
      if (u.startsWith(srv.url) || u.startsWith("blob:") || u.startsWith("data:")) return route.continue();
      blocked.push(u);
      return route.abort("blockedbyclient");
    });
  }
  const consoleMsgs = [];
  page.on("console", (m) => ["error", "warning"].includes(m.type()) && consoleMsgs.push(`${m.type()}: ${m.text().slice(0, 250)}`));
  const reqs = trackRequests(page, srv.url);
  const out = { steps: {} };
  try {
    await page.goto(srv.url);
    await page.waitForFunction(() => window.spikeReady);
    out.init = await page.evaluate(() => window.spike.init()).then((r) => ({ ok: true, v: r.version.v }), (e) => ({ error: e.message.slice(0, 300) }));
    for (const [label, sqls] of Object.entries(steps(srv.url))) {
      out.steps[label] = await page.evaluate((s) => window.spike.script(s), sqls);
    }
  } catch (e) {
    out.fatal = String(e.message).slice(0, 400);
  }
  out.nonLocalRequests = reqs.filter((r) => r.external).map((r) => ({ url: r.url, failed: r.failed ?? null }));
  out.extensionRequests = reqs.filter((r) => /duckdb_extension/.test(r.url)).map((r) => ({ url: r.url.replace(srv.url, "<console-origin>"), status: r.status, encoding: r.encoding, wireBytes: r.wireBytes, failed: r.failed }));
  out.serverLog = srv.log.filter((l) => l.ext);
  out.blockedByTest = blocked;
  out.console = consoleMsgs.slice(0, 6);
  await browser.close();
  await srv.close();
  results.scenarios[name] = out;
  console.log(name, JSON.stringify(out.extensionRequests.map((r) => r.url + " " + (r.status ?? r.failed) + " " + r.wireBytes)));
}

const sp = (o) => o;
const ONLY_F = process.env.ONLY_F === "1";
if (!ONLY_F) {
// A. Default repository (extensions.duckdb.org), measure per-extension wire size.
await scenario("A_default_repo", {
  steps: () => ({
    install_load: ["INSTALL spatial", "LOAD spatial", "select ST_AsText(ST_Point(1,2)) wkt"],
    parquet_autoload: ["create table t as select 1 a", "copy t to 'a.parquet' (format parquet)"],
    json: ["select '{\"a\":1}'::JSON j"],
    icu: ["LOAD icu", "select '2026-01-01 00:00:00+02'::timestamptz::varchar tz"],
  }),
});

// B. Self-hosted repository on the console origin, third parties aborted by the test harness, strict CSP.
const stepsB = (url) => ({
  setup: [`SET custom_extension_repository='${url}/ext'`, "SET autoinstall_known_extensions=false", "SET autoload_known_extensions=false"],
  load: ["INSTALL spatial", "LOAD spatial", "LOAD parquet", "LOAD json", "select ST_AsText(ST_Point(1,2)) wkt", "create table t as select 1 a", "copy t to 'a.parquet' (format parquet)", "select count(*) n from 'a.parquet'"],
  load_icu: ["LOAD icu", "select '2026-01-01 00:00:00+02'::timestamptz::varchar tz"],
  verify: ["select extension_name, loaded, installed, install_path from duckdb_extensions() where loaded and extension_name in ('spatial','parquet','icu')"],
});
await scenario("B_self_hosted_strict_csp_third_parties_blocked", { csp: "strict", blockThirdParty: true, steps: stepsB });

// C. Same, but with autoload left ON and custom repo set: does the autoloader honour the custom repo?
await scenario("C_self_hosted_autoload_on", {
  csp: "strict", blockThirdParty: true,
  steps: (url) => ({
    setup: [`SET custom_extension_repository='${url}/ext'`],
    autoload_parquet: ["create table t as select 1 a", "copy t to 'a.parquet' (format parquet)", "select count(*) n from 'a.parquet'"],
  }),
});

// D. Default repository left in place but the extension host is blocked: shows the failure mode.
await scenario("D_default_repo_blocked", {
  blockThirdParty: true,
  steps: () => ({ load: ["INSTALL spatial", "LOAD spatial"] }),
});

}
// F. HTTP-cache + offline: first visit online, then a fresh page in the same context with the network
//    switched off. (Playwright route interception disables the HTTP cache, so we use setOffline.)
for (const mode of ["self_hosted_immutable", "default_repo"]) {
  const srv = await startServer({ dir, csp: mode === "default_repo" ? "none" : "strict", extDir: "ext-mirror", cacheControl: "public, max-age=31536000, immutable" });
  const browser = await launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const sql = mode === "self_hosted_immutable" ? [`SET custom_extension_repository='${srv.url}/ext'`, "LOAD spatial", "select ST_AsText(ST_Point(1,2)) wkt"] : ["LOAD spatial", "select ST_AsText(ST_Point(1,2)) wkt"];
  await page.goto(srv.url);
  await page.waitForFunction(() => window.spikeReady);
  await page.evaluate(() => window.spike.init());
  const online = await page.evaluate((s) => window.spike.script(s), sql);
  await page.close();
  await ctx.setOffline(true);
  const page2 = await ctx.newPage();
  const offlineOut = { online: online.map((c) => c.error ?? "ok") };
  try {
    await page2.goto(srv.url, { timeout: 10000 });
    await page2.waitForFunction(() => window.spikeReady, null, { timeout: 10000 });
    await page2.evaluate(() => window.spike.init());
    const off = await page2.evaluate((s) => window.spike.script(s), sql);
    offlineOut.offline = off.map((c) => c.error ?? "ok");
  } catch (e) { offlineOut.offlineError = String(e.message).slice(0, 200); }
  results.scenarios["F_offline_after_cache_" + mode] = offlineOut;
  console.log("F", mode, JSON.stringify(offlineOut));
  await browser.close(); await srv.close();
}

// E. Unsigned / tampered file: flip one byte in the mirrored extension and see whether LOAD rejects it.
import { copyFileSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
mkdirSync(`ext-mirror-tampered/${version}/wasm_eh`, { recursive: true });
const b = readFileSync(`ext-mirror/${version}/wasm_eh/json.duckdb_extension.wasm`);
b[Math.floor(b.length / 2)] ^= 0xff;
writeFileSync(`ext-mirror-tampered/${version}/wasm_eh/json.duckdb_extension.wasm`, b);
{
  const srv = await startServer({ dir, csp: "strict", extDir: "ext-mirror-tampered" });
  const browser = await launch();
  const page = await browser.newPage();
  await page.goto(srv.url);
  await page.waitForFunction(() => window.spikeReady);
  await page.evaluate(() => window.spike.init());
  results.scenarios.E_tampered_extension = await page.evaluate((u) => window.spike.script([`SET custom_extension_repository='${u}/ext'`, "SET autoload_known_extensions=false", "INSTALL json", "LOAD json"]), srv.url);
  console.log("E", JSON.stringify(results.scenarios.E_tampered_extension.slice(-1)));
  await browser.close(); await srv.close();
}
if (!ONLY_F) save(`extensions-${alias}.json`, results);
else save(`extensions-F-${alias}.json`, results);
