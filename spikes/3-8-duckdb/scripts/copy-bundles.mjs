// Copies the DuckDB-WASM bundles of one installed alias into public/duckdb/ (self-hosting, no CDN)
// and writes bundles.json describing them. Usage: node scripts/copy-bundles.mjs duckdb-1.32.0
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const alias = process.argv[2];
if (!alias) throw new Error("usage: copy-bundles.mjs <alias>");
const dist = join("node_modules", alias, "dist");
const out = join("public", "duckdb");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const files = readdirSync(dist).filter(
  (f) => f.endsWith(".wasm") || /^duckdb-browser-.*worker\.js$/.test(f),
);
for (const f of files) cpSync(join(dist, f), join(out, f));
const version = JSON.parse(readFileSync(join("node_modules", alias, "package.json"), "utf8")).version;
// Bundle layouts differ between releases: mvp/eh/coi (<=1.33.1-dev65) vs base/threads (dev110+).
const has = (f) => files.includes(f);
const bundles = {};
for (const [k, wasm, worker, pthread] of [
  ["mvp", "duckdb-mvp.wasm", "duckdb-browser-mvp.worker.js"],
  ["eh", "duckdb-eh.wasm", "duckdb-browser-eh.worker.js"],
  ["coi", "duckdb-coi.wasm", "duckdb-browser-coi.worker.js", "duckdb-browser-coi.pthread.worker.js"],
  ["base", "duckdb-base.wasm", "duckdb-browser-base.worker.js"],
  ["threads", "duckdb-threads.wasm", "duckdb-browser-threads.worker.js", "duckdb-browser-threads.pthread.worker.js"],
]) {
  if (has(wasm) && has(worker)) {
    bundles[k] = { mainModule: `/duckdb/${wasm}`, mainWorker: `/duckdb/${worker}`, ...(pthread ? { pthreadWorker: `/duckdb/${pthread}` } : {}) };
  }
}
writeFileSync(join(out, "bundles.json"), JSON.stringify({ alias, version, files, bundles }, null, 2));
console.log(alias, version, Object.keys(bundles).join(","));
