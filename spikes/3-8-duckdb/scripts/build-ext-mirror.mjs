// Builds the self-hosted DuckDB extension mirror in .cache/ext-mirror/<version>/<platform>/.
// Downloads each extension once, verifies its sha256 against the committed manifest
// (results/extensions-<version>-<platform>.json) and re-checks every cached file on each run,
// so a mirror that was downloaded earlier can never go stale or tampered without failing loudly.
// Binaries are gitignored (.cache/); the manifest with raw/gzip/brotli sizes and sha256s is committed.
// usage: node scripts/build-ext-mirror.mjs v1.4.3 wasm_eh spatial,parquet,json,icu,httpfs
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import zlib from "node:zlib";

const [version = "v1.4.3", platform = "wasm_eh", names = "spatial,parquet,json,icu,httpfs"] =
  process.argv.slice(2);
const manifestFile = `results/extensions-${version}-${platform}.json`;
mkdirSync("results", { recursive: true });
const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")) : {};
const fail = (m) => {
  console.error(`FATAL: ${m}`);
  process.exit(1);
};

for (const n of names.split(",")) {
  const url = `https://extensions.duckdb.org/${version}/${platform}/${n}.duckdb_extension.wasm`;
  const dest = `.cache/ext-mirror/${version}/${platform}/${n}.duckdb_extension.wasm`;
  let buf = null;
  const cached = existsSync(dest) && readFileSync(dest);
  if (cached && manifest[n]?.sha256) {
    const h = createHash("sha256").update(cached).digest("hex");
    if (h === manifest[n].sha256) {
      console.log(`${n}: cache OK (${h} matches manifest), no download needed`);
      continue;
    }
    console.log(`${n}: cache sha mismatch (${h} != ${manifest[n].sha256}), re-downloading`);
  }
  const res = await fetch(url, { headers: { "accept-encoding": "identity" } });
  if (!res.ok) fail(`download ${url} -> HTTP ${res.status}`);
  buf = Buffer.from(await res.arrayBuffer());
  const sha256 = createHash("sha256").update(buf).digest("hex");
  if (manifest[n]?.sha256 && sha256 !== manifest[n].sha256)
    fail(
      `sha256 mismatch against manifest for ${n}: got ${sha256}, manifest says ${manifest[n].sha256}`,
    );
  mkdirSync(`.cache/ext-mirror/${version}/${platform}`, { recursive: true });
  writeFileSync(dest, buf);
  manifest[n] = {
    url,
    rawBytes: buf.length,
    gzipBytes: zlib.gzipSync(buf, { level: 9 }).length,
    brotliBytes: zlib.brotliCompressSync(buf, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
      },
    }).length,
    sha256,
  };
  console.log(`${n}: downloaded + verified ${buf.length} B, sha256 ${sha256}`);
}
writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
console.log(
  `mirror ready: .cache/ext-mirror/${version}/${platform}/ (${names}); manifest: ${manifestFile}`,
);
