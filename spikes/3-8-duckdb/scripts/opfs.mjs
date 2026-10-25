// OPFS persistence: reload, browser restart, crash-ish (no checkpoint), two tabs, large data, spatial types.
import { startServer } from "./server.mjs";
import { chromium } from "playwright-core";
import { CHROMIUM, save, trackRequests } from "./lib.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const alias = process.argv[2] ?? "duckdb-dev65";
const _version = process.argv[3] ?? "v1.5.6";
const results = { alias, chromium: "headless Chromium only (Firefox / Safari not run)" };
const srv = await startServer({
  dir: `.tmp/dist-${alias}-shim`,
  csp: "strict",
  extDir: ".cache/ext-mirror",
  cacheControl: "no-store",
});
const repo = `SET custom_extension_repository='${srv.url}/ext'`;
// fail loudly: every unexpected error is collected; the run exits 1 at the end (second tab
// opening the same OPFS file is an EXPECTED failure — OPFS sync access handles lock the file)
const failures = [];
const attempt = async (label, f) => {
  const r = await (async () => {
    try {
      return await f();
    } catch (e) {
      return { error: String(e.message).slice(0, 400) };
    }
  })();
  if (r.error && !label.endsWith("-expected")) failures.push(`${label}: ${r.error}`);
  return r;
};
const open = async (page, path) => {
  await page.goto(srv.url);
  await page.waitForFunction(() => window.spikeReady);
  return page.evaluate((p) => window.spike.init({ path: p }), path);
};

// 1. same context, reload
{
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const r = (results.reload = {});
  r.env = await (async () => {
    await page.goto(srv.url);
    await page.waitForFunction(() => window.spikeReady);
    return page.evaluate(async () => ({
      ...(await window.spike.env()),
      estimate: await navigator.storage.estimate(),
      persisted: await navigator.storage.persisted(),
    }));
  })();
  r.open = await attempt("reload.open", () =>
    open(page, "opfs://spike.db").then((x) => x.version.v),
  );
  r.write = await attempt("reload.write", () => page.evaluate(() => window.spike.persistWrite()));
  await page.evaluate(() => window.spike.close());
  r.opfsFiles = await page.evaluate(async () => {
    const out = [];
    const root = await navigator.storage.getDirectory();
    for await (const [n, h] of root.entries())
      out.push({ n, size: h.kind === "file" ? (await h.getFile()).size : null });
    return out;
  });
  await page.reload();
  await page.waitForFunction(() => window.spikeReady);
  await page.evaluate(() => window.spike.init({ path: "opfs://spike.db" }));
  r.readAfterReload = await attempt("reload.readAfterReload", () =>
    page.evaluate(() => window.spike.persistRead()),
  );
  // write without close/checkpoint, then hard navigate away ("crash")
  await page.evaluate(() =>
    window.spike.script(["insert into persisted select * from range(2000, 2500)"]),
  );
  await page.goto("about:blank");
  r.afterUncheckpointedWriteAndNavigateAway = await attempt("reload.afterCrashWrite", async () => {
    await open(page, "opfs://spike.db");
    return page.evaluate(() => window.spike.persistRead());
  });
  r.opfsFilesAfter = await page.evaluate(async () => {
    const out = [];
    const root = await navigator.storage.getDirectory();
    for await (const [n, h] of root.entries())
      out.push({ n, size: h.kind === "file" ? (await h.getFile()).size : null });
    return out;
  });
  // second tab opening the same file while the first still has it open
  const page2 = await ctx.newPage();
  r.secondTabWhileFirstOpen = await attempt("reload.secondTab-expected", async () => {
    await open(page2, "opfs://spike.db");
    return page2.evaluate(() => window.spike.persistRead());
  });
  await browser.close();
}

// 2. browser restart (persistent profile)
{
  const dir = mkdtempSync(join(tmpdir(), "duck-profile-"));
  const r = (results.browserRestart = {});
  let ctx = await chromium.launchPersistentContext(dir, { executablePath: CHROMIUM });
  let page = ctx.pages()[0] ?? (await ctx.newPage());
  await open(page, "opfs://restart.db");
  r.write = await attempt("restart.write", () => page.evaluate(() => window.spike.persistWrite()));
  await page.evaluate(() => window.spike.close());
  await ctx.close();
  ctx = await chromium.launchPersistentContext(dir, { executablePath: CHROMIUM });
  page = ctx.pages()[0] ?? (await ctx.newPage());
  await open(page, "opfs://restart.db");
  r.readAfterRestart = await attempt("restart.readAfterRestart", () =>
    page.evaluate(() => window.spike.persistRead()),
  );
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
  r.load = await page.evaluate(() =>
    window.spike.load(200000, "arrow").then((x) => ({ totalMs: x.totalMs, counts: x.counts })),
  );
  r.setupSpatial = await page.evaluate(
    (sql) =>
      window.spike.script([
        sql,
        "LOAD spatial",
        "create table member_geo as select member_id, ST_Point(lon, lat) geom from members",
        "checkpoint",
      ]),
    repo,
  );
  await page.evaluate(() => window.spike.close());
  r.opfsFiles = await page.evaluate(async () => {
    const out = [];
    const root = await navigator.storage.getDirectory();
    for await (const [n, h] of root.entries())
      out.push({
        n,
        MB: h.kind === "file" ? Math.round((await h.getFile()).size / 1e4) / 100 : null,
      });
    return out;
  });
  await page.reload();
  await page.waitForFunction(() => window.spikeReady);
  const t0 = Date.now();
  await page.evaluate(() => window.spike.init({ path: "opfs://large.db" }));
  r.reopenInitMs = Date.now() - t0;
  r.reopenCounts = await page.evaluate(() =>
    window.spike.script(["select count(*) n from orders", "select count(*) n from members"]),
  );
  for (const c of r.reopenCounts)
    if (c.error) failures.push(`large200k.reopenCounts ${c.sql}: ${c.error}`);
  const n0 = reqs.length;
  r.geometryWithoutLoadSpatial = await page.evaluate(() =>
    window.spike.script([
      "select count(*) n from member_geo",
      "select ST_AsText(geom) from member_geo limit 1",
      "select extension_name from duckdb_extensions() where loaded",
    ]),
  );
  r.geometryWithoutLoadSpatialRequests = reqs
    .slice(n0)
    .map((q) => q.url.replace(srv.url, "<origin>"));
  r.geometryAfterLoad = await page.evaluate(
    (sql) =>
      window.spike.script([
        sql,
        "LOAD spatial",
        "select ST_AsText(geom) wkt from member_geo limit 1",
      ]),
    repo,
  );
  r.aggAfterReopen = await page.evaluate(() =>
    window.spike
      .aggregates(3)
      .then((a) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v.medianMs]))),
  );
  for (const c of r.setupSpatial)
    if (c.error) failures.push(`large200k.setupSpatial ${c.sql}: ${c.error}`);
  for (const c of r.geometryAfterLoad)
    if (c.error) failures.push(`large200k.geometryAfterLoad ${c.sql}: ${c.error}`);
  await browser.close();
}

// 4. OPFS unavailable: the console must feature-detect (a real getDirectory call, not just property
//    presence) and fall back to an in-memory database — init must not crash, writes work for the
//    session, and nothing survives a reload (documented behaviour of the fallback).
{
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator.storage, "getDirectory", {
      value: () => Promise.reject(new Error("opfs disabled by test")),
    });
  });
  const r = (results.opfsUnavailableFallback = {});
  await page.goto(srv.url);
  await page.waitForFunction(() => window.spikeReady);
  r.init = await page.evaluate(async () => {
    try {
      const x = await window.spike.init({ path: "opfs://fallback.db" });
      return { storage: x.storage, engine: x.version.v };
    } catch (e) {
      return { error: String(e.message).slice(0, 300) };
    }
  });
  if (r.init.error || r.init.storage !== "memory")
    failures.push(`fallback.init: expected storage "memory", got ${JSON.stringify(r.init)}`);
  const memWrite = await page.evaluate(() => window.spike.persistWrite());
  r.inMemoryWrite = memWrite;
  if (memWrite?.n !== 2000)
    failures.push(`fallback.inMemoryWrite: expected n=2000, got ${JSON.stringify(memWrite)}`);
  await page.reload();
  await page.waitForFunction(() => window.spikeReady);
  await page.evaluate(() => window.spike.init({ path: "opfs://fallback.db" }));
  r.tableGoneAfterReload = await page.evaluate(async () => {
    try {
      const v = await window.spike.persistRead();
      return { persisted: true, n: v.n };
    } catch (e) {
      return { persisted: false, reason: String(e).slice(0, 160) };
    }
  });
  if (r.tableGoneAfterReload.persisted)
    failures.push(
      `fallback.tableGoneAfterReload: data survived a reload outside OPFS: ${JSON.stringify(r.tableGoneAfterReload)}`,
    );
  await browser.close();
}

await srv.close();
// fail loudly: any unexpected error collected along the way exits 1
if (failures.length) {
  save(`opfs-${alias}.json`, results);
  console.error(`OPFS SCENARIO FAILURES (${failures.length}):\n- ` + failures.join("\n- "));
  process.exit(1);
}
save(`opfs-${alias}.json`, results);
console.log(JSON.stringify(results, null, 1).slice(0, 6000));
