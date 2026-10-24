// Static server for the spike: configurable CSP / COOP+COEP, on-the-fly gzip/brotli (so transfer
// sizes are real), request log, and an optional self-hosted DuckDB extension repository at /ext/.
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, createReadStream } from "node:fs";
import { join, extname, normalize } from "node:path";
import zlib from "node:zlib";

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".css": "text/css",
};

export const CSP = {
  none: null,
  // the policy from the task: everything same-origin, wasm compile + blob: workers allowed
  strict:
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'",
  // minimal candidates, to find what is really required
  noBlob:
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'",
  noWasmEval: "default-src 'self'; script-src 'self'; worker-src 'self' blob:; connect-src 'self'",
  noWorkerDirective: "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'",
  scriptSrcOnlySelf:
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'",
  // adds the default extension host (the thing the strict policy is meant to rule out)
  // smallest policy that was found to work (see results/csp.json)
  minimal: "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'",
  minimalWithBlob:
    "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'",
  unsafeEval:
    "default-src 'self'; script-src 'self' 'unsafe-eval'; worker-src 'self' blob:; connect-src 'self'",
  extHost:
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' https://extensions.duckdb.org",
};

const cache = new Map();
function compressed(path, enc, buf) {
  const k = enc + path;
  if (!cache.has(k))
    cache.set(
      k,
      enc === "br"
        ? zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } })
        : zlib.gzipSync(buf, { level: 6 }),
    );
  return cache.get(k);
}

/** @returns {Promise<{url:string, log:Array, close:()=>Promise<void>}>} */
export function startServer({
  dir,
  csp = "none",
  coi = false,
  port = 0,
  extDir = null,
  cacheControl = "no-store",
} = {}) {
  const log = [];
  const policy = csp in CSP ? CSP[csp] : csp;
  const srv = createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    let path = decodeURIComponent(u.pathname);
    const enc = (req.headers["accept-encoding"] ?? "").includes("br")
      ? "br"
      : (req.headers["accept-encoding"] ?? "").includes("gzip")
        ? "gzip"
        : null;
    const headers = { "cache-control": cacheControl };
    if (policy) headers["content-security-policy"] = policy;
    if (coi) {
      headers["cross-origin-opener-policy"] = "same-origin";
      headers["cross-origin-embedder-policy"] = "require-corp";
    }
    // --- self-hosted extension repository: raw files exactly as extensions.duckdb.org stores them; compressed on the fly like its CDN does ---
    if (path.startsWith("/ext/") && extDir) {
      const f = normalize(join(extDir, path.slice(5)));
      if (!f.startsWith(normalize(extDir)) || !existsSync(f)) {
        log.push({ path, status: 404 });
        res.writeHead(404, headers);
        return res.end();
      }
      const raw = readFileSync(f);
      const body = enc ? compressed(f, enc, raw) : raw;
      log.push({ path, status: 200, bytes: raw.length, transfer: body.length, enc, ext: true });
      res.writeHead(200, {
        ...headers,
        "content-type": "application/wasm",
        ...(enc ? { "content-encoding": enc } : {}),
        "content-length": body.length,
        "access-control-allow-origin": "*",
      });
      return res.end(body);
    }
    if (path === "/") path = "/index.html";
    const f = normalize(join(dir, path));
    if (!f.startsWith(normalize(dir)) || !existsSync(f) || !statSync(f).isFile()) {
      log.push({ path, status: 404 });
      res.writeHead(404, headers);
      return res.end("nf");
    }
    const type = MIME[extname(f)] ?? "application/octet-stream";
    const compressible = [".js", ".wasm", ".html", ".json", ".mjs"].includes(extname(f));
    if (compressible && enc) {
      const raw = readFileSync(f);
      const body = compressed(f, enc, raw);
      log.push({ path, status: 200, bytes: raw.length, transfer: body.length, enc });
      res.writeHead(200, {
        ...headers,
        "content-type": type,
        "content-encoding": enc,
        "content-length": body.length,
      });
      return res.end(body);
    }
    const size = statSync(f).size;
    log.push({ path, status: 200, bytes: size, transfer: size });
    res.writeHead(200, { ...headers, "content-type": type, "content-length": size });
    createReadStream(f).pipe(res);
  });
  return new Promise((resolve) =>
    srv.listen(port, "127.0.0.1", () => {
      const p = srv.address().port;
      resolve({
        url: `http://127.0.0.1:${p}`,
        log,
        close: () =>
          new Promise((r) => {
            srv.closeAllConnections?.();
            srv.close(() => r());
          }),
      });
    }),
  );
}
