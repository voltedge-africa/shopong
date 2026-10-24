// OPFS persistence: reload, browser restart, crash-ish (no checkpoint), two tabs, large data, spatial types.
import { startServer } from "./server.mjs";
import { chromium } from "playwright-core";
import { CHROMIUM, save, trackRequests } from "./lib.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const alias = process.argv[2] ?? "duckdb-dev65";
const version = process.argv[3] ?? "v1.5.6";
const results = { alias, chromium: "headless Chromium only (Firefox / Safari not run)" };
const srv = await startServer({ dir: `.tmp/dist-${alias}-shim`, csp: "strict", extDir: "ext-mirror", cacheControl: "no-store" });
const repo = `SET custom_extension_repository='${srv.url}/ext'`;
const attempt = async (f) => { try { return await f(); } catch (e) { return { error: String(e.message).slice(0, 400) }; } };
const open = async (page, path) => { await page.goto(srv.url); await page.waitForFunction(() => window.spikeReady); return page.evaluate((p) => window.spike.init({ path: p }), path); };

// 1. same context, reload
{
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const r = (results.reload = {});
  r.env = await (async () => { await page.goto(srv.url); await page.waitForFunction(() => window.spikeReady); return page.evaluate(async () => ({ ...(await window.spike.env()), estimate: await navigator.storage.estimate(), persisted: await navigator.storage.persisted() })); })();
  r.open = await attempt(() => open(page, "opfs://spike.db").then((x) => x.version.v));
  r.write = await attempt(() => page.evaluate(() => window.spike.persistWrite()));
  await page.evaluate(() => window.spike.close());
  r.opfsFiles = await page.evaluate(async () => { const out = []; const root = await navigator.storage.getDirectory(); for await (const [n, h] of root.entries()) out.push({ n, size: h.kind === "file" ? (await h.getFile()).size : null }); return out; });
  await page.reload();
  await page.waitForFunction(() => window.spikeReady);
  await page.evaluate(() => window.spike.init({ path: "opfs://spike.db" }));
  r.readAfterReload = await attempt(() => page.evaluate(() => window.spike.persistRead()));
  // write without close/checkpoint, then hard navigate away ("crash")
  await page.evaluate(() => window.spike.script(["insert into persisted select * from range(2000, 2500)"]));
  await page.goto("about:blank");
  r.afterUncheckpointedWriteAndNavigateAway = await attempt(async () => { await open(page, "opfs://spike.db"); return page.evaluate(() => window.spike.persistRead()); });
  r.opfsFilesAfter = await page.evaluate(async () => { const out = []; const root = await navigator.storage.getDirectory(); for await (const [n, h] of root.entries()) out.push({ n, size: h.kind === "file" ? (await h.getFile()).size : null }); return out; });
  // second tab opening the same file while the first still has it open
  const page2 = await ctx.newPage();
  r.secondTabWhileFirstOpen = await attempt(async () => { await open(page2, "opfs://spike.db"); return page2.evaluate(() => window.spike.persistRead()); });
  await browser.close();
}

// 2. browser restart (persistent profile)
{
  const dir = mkdtempSync(join(tmpdir(), "duck-profile-"));
  const r = (results.browserRestart = {});
  let ctx = await chromium.launchPersistentContext(dir, { executablePath: CHROMIUM });
  let page = ctx.pages()[0] ?? (await ctx.newPage());
  await open(page, "opfs://restart.db");
  r.write = await attempt(() => page.evaluate(() => window.spike.persistWrite()));
  await page.evaluate(() => window.spike.close());
  await ctx.close();
  ctx = await chromium.launchPersistentContext(dir, { executablePath: CHROMIUM });
  page = ctx.pages()[0] ?? (await ctx.newPage());
  await open(page, "opfs://restart.db");
  r.readAfterRestart = await attempt(() => page.evaluate(() => window.spike.persistRead()));
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
}

// 3. large dataset persisted: size on disk, write time, reopen time, + spatial GEOMETRY column round trip
{
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  const page = await (await browser.newContext()).newPage();
  const r = (results.large200k = {});
  const reqs = trackRequests(page, srv.url);
  await open(page, "opfs://large.db");
  r.load = await page.evaluate(() => window.spike.load(200000, "arrow").then((x) => ({ totalMs: x.totalMs, counts: x.counts })));
  r.setupSpatial = await page.evaluate((sql) => window.spike.script([sql, "LOAD spatial", "create table member_geo as select member_id, ST_Point(lon, lat) geom from members", "checkpoint"]), repo);
  await page.evaluate(() => window.spike.close());
  r.opfsFiles = await page.evaluate(async () => { const out = []; const root = await navigator.storage.getDirectory(); for await (const [n, h] of root.entries()) out.push({ n, MB: h.kind === "file" ? Math.round((await h.getFile()).size / 1e4) / 100 : null }); return out; });
  await page.reload();
  await page.waitForFunction(() => window.spikeReady);
  const t0 = Date.now();
  await page.evaluate(() => window.spike.init({ path: "opfs://large.db" }));
  r.reopenInitMs = Date.now() - t0;
  r.reopenCounts = await page.evaluate(() => window.spike.script(["select count(*) n from orders", "select count(*) n from members"]));
  const n0 = reqs.length;
  r.geometryWithoutLoadSpatial = await page.evaluate(() => window.spike.script(["select count(*) n from member_geo", "select ST_AsText(geom) from member_geo limit 1", "select extension_name from duckdb_extensions() where loaded"]));
  r.geometryWithoutLoadSpatialRequests = reqs.slice(n0).map((q) => q.url.replace(srv.url, "<origin>"));
  r.geometryAfterLoad = await page.evaluate((sql) => window.spike.script([sql, "LOAD spatial", "select ST_AsText(geom) wkt from member_geo limit 1"]), repo);
  r.aggAfterReopen = await page.evaluate(() => window.spike.aggregates(3).then((a) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v.medianMs]))));
  await browser.close();
}
await srv.close();
save(`opfs-${alias}.json`, results);
console.log(JSON.stringify(results, null, 1).slice(0, 6000));
