// CSP matrix: serve the console with different policies, record what breaks.
import { startServer, CSP } from "./server.mjs";
import { launch, save } from "./lib.mjs";

const alias = process.argv[2] ?? "duckdb-dev65";
const rows = [
  // [name, csp key, dist suffix, coi, bundle]
  ["task policy (shim build)", "strict", "-shim", false, undefined],
  ["task policy, stock apache-arrow", "strict", "", false, undefined],
  ["no blob: in worker-src", "noBlob", "-shim", false, undefined],
  [
    "no worker-src directive (falls back to script-src)",
    "noWorkerDirective",
    "-shim",
    false,
    undefined,
  ],
  ["no 'wasm-unsafe-eval'", "noWasmEval", "-shim", false, undefined],
  [
    "default-src none, script-src self+wasm-unsafe-eval, connect-src self (no worker-src)",
    "minimal",
    "-shim",
    false,
    undefined,
  ],
  [
    "same + 'unsafe-eval' instead of wasm-unsafe-eval, stock arrow",
    "unsafeEval",
    "",
    false,
    undefined,
  ],
  ["task policy + COOP/COEP, threaded coi bundle", "strict", "-shim", true, "coi"],
  ["no blob + COOP/COEP, threaded coi bundle", "noBlob", "-shim", true, "coi"],
  ["task policy, mvp bundle (non-EH fallback)", "strict", "-shim", false, "mvp"],
];
const out = [];
for (const [name, key, suffix, coi, bundle] of rows) {
  const srv = await startServer({
    dir: `.tmp/dist-${alias}${suffix}`,
    csp: key,
    coi,
    extDir: "ext-mirror",
  });
  const browser = await launch();
  const page = await (await browser.newContext()).newPage();
  const violations = new Set();
  const consoleErrors = new Set();
  page.on("console", (m) => {
    const t = m.text();
    if (/Content Security Policy|Refused to/.test(t))
      violations.add(t.replace(/http:\/\/127\.0\.0\.1:\d+/g, "<origin>").slice(0, 260));
    else if (m.type() === "error" && !/404/.test(t)) consoleErrors.add(t.slice(0, 200));
  });
  const row = {
    name,
    csp: CSP[key],
    build: suffix ? "arrow isValid shim" : "stock apache-arrow",
    coi,
    bundle: bundle ?? "auto",
    steps: {},
  };
  const step = async (n, f) => {
    try {
      await f();
      row.steps[n] = "ok";
    } catch (e) {
      row.steps[n] = "FAIL: " + String(e.message).split("\n")[0].slice(0, 200);
    }
  };
  try {
    await page.goto(srv.url);
    await page.waitForFunction(() => window.spikeReady, null, { timeout: 5000 });
    await step("instantiate (wasm + worker)", async () => {
      const r = await page.evaluate((b) => window.spike.init({ bundle: b }), bundle);
      row.bundleUsed = r.bundle;
      row.crossOriginIsolated = r.crossOriginIsolated;
      row.engine = r.version.v;
    });
    await step("insert JSON rows", () => page.evaluate(() => window.spike.load(10000, "json")));
    await step("insert Arrow rows (apache-arrow Builder)", () =>
      page.evaluate(() => window.spike.load(10000, "arrow")),
    );
    await step("SQL aggregates", () => page.evaluate(() => window.spike.aggregates(1)));
    await step("LOAD spatial from console origin", async () => {
      const r = await page.evaluate(
        (u) =>
          window.spike.script([
            `SET custom_extension_repository='${u}/ext'`,
            "LOAD spatial",
            "select ST_AsText(ST_Point(1,2)) x",
          ]),
        srv.url,
      );
      const bad = r.find((c) => c.error);
      if (bad) throw new Error(bad.error);
    });
    await step("Parquet export/import", () => page.evaluate(() => window.spike.parquetRoundTrip()));
  } catch (e) {
    row.fatal = String(e.message).split("\n")[0].slice(0, 200);
  }
  row.violations = [...violations].slice(0, 4);
  row.otherConsoleErrors = [...consoleErrors].slice(0, 3);
  out.push(row);
  console.log(name, "=>", JSON.stringify(row.steps), row.fatal ?? "");
  await browser.close();
  await srv.close();
}
save(`csp-${alias}.json`, out);
