// Mirror DuckDB-WASM extensions from extensions.duckdb.org into ext-mirror/ (self-hosted repository).
// Layout (as observed from the loader): <repo>/<duckdb version>/<platform>/<name>.duckdb_extension.wasm
// usage: node scripts/mirror-extensions.mjs v1.5.6 wasm_eh spatial,parquet,json,icu,httpfs
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import zlib from "node:zlib";

const [version = "v1.5.6", platform = "wasm_eh", names = "spatial,parquet"] = process.argv.slice(2);
const out = {};
for (const n of names.split(",")) {
  const url = `https://extensions.duckdb.org/${version}/${platform}/${n}.duckdb_extension.wasm`;
  const res = await fetch(url, { headers: { "accept-encoding": "identity" } });
  if (!res.ok) {
    out[n] = { url, status: res.status };
    continue;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(`ext-mirror/${version}/${platform}`, { recursive: true });
  writeFileSync(`ext-mirror/${version}/${platform}/${n}.duckdb_extension.wasm`, buf);
  out[n] = {
    url,
    rawBytes: buf.length,
    gzipBytes: zlib.gzipSync(buf, { level: 9 }).length,
    brotliBytes: zlib.brotliCompressSync(buf, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
      },
    }).length,
    sha256: createHash("sha256").update(buf).digest("hex"),
  };
  console.log(n, out[n].rawBytes, out[n].brotliBytes);
}
mkdirSync("results", { recursive: true });
writeFileSync(
  `results/extensions-${version}-${platform}.json`,
  JSON.stringify(out, null, 2) + "\n",
);
