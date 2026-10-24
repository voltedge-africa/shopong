// Version matrix: same functional checks against each candidate @duckdb/duckdb-wasm build.
import { startServer } from "./server.mjs";
import { launch, trackRequests, save } from "./lib.mjs";

const aliases = (process.argv[2] ?? "duckdb-1.32.0,duckdb-dev57,duckdb-dev65,duckdb-dev110").split(",");
const results = {};
for (const alias of aliases) {
  const r = (results[alias] = { steps: {}, console: [] });
  const srv = await startServer({ dir: `.tmp/dist-${alias}`, csp: "none" });
  const browser = await launch();
  const page = await browser.newPage();
  page.on("console", (m) => ["error", "warning"].includes(m.type()) && r.console.push(`${m.type()}: ${m.text().slice(0, 300)}`));
  page.on("pageerror", (e) => r.console.push("pageerror: " + e.message.slice(0, 300)));
  const reqs = trackRequests(page, srv.url);
  const step = async (name, f) => {
    try { r.steps[name] = await f(); } catch (e) { r.steps[name] = { error: String(e.message).slice(0, 500) }; }
  };
  try {
    await page.goto(srv.url);
    await page.waitForFunction(() => window.spikeReady);
    await step("init", () => page.evaluate(() => window.spike.init()));
    await step("load10kJson", () => page.evaluate(() => window.spike.load(10000, "json")));
    await step("load10kArrow", () => page.evaluate(() => window.spike.load(10000, "arrow")));
    await step("aggregates", () => page.evaluate(() => window.spike.aggregates(3)));
    await step("spatial", () => page.evaluate(() => window.spike.spatial()));
    await step("parquet", () => page.evaluate(() => window.spike.parquetRoundTrip()));
    await step("kepler", () => page.evaluate(() => window.spike.keplerShape()));
  } finally {
    r.externalRequests = reqs.filter((q) => q.external).map(({ url, failed }) => ({ url, failed }));
    await browser.close();
    await srv.close();
  }
  const ok = (s) => (r.steps[s] && !r.steps[s].error ? "ok" : "FAIL");
  console.log(alias, r.steps.init?.version?.v ?? r.steps.init?.error, r.steps.init?.platform?.[0]?.platform, "load:", ok("load10kJson"), ok("load10kArrow"), "spatial:", r.steps.spatial?.load?.value ?? "-", "parquet:", ok("parquet"));
}
save("version-matrix.json", results);
