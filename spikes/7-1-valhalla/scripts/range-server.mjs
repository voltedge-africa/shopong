// Minimal static server for the spike: byte ranges (206), strong SHA-256 ETags, CORS, request log.
//   /datasets/**  -> .cache/valhalla/datasets (immutable release dirs)
//   /sdk/**       -> node_modules/valhalla-browser/dist  (same-origin worker + wasm)
//   /pages/**     -> spikes/7-1-valhalla/pages
// Env: PORT (8090), CSP (optional Content-Security-Policy applied to /pages and /sdk responses; workers take their CSP from their own script response), DATA_ORIGIN_ONLY=1 to serve only /datasets.
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPIKE, DATASETS } from './lib.mjs';

const roots = {
  '/datasets/': DATASETS,
  '/sdk/': path.join(SPIKE, 'node_modules', 'valhalla-browser', 'dist'),
  '/pages/': path.join(SPIKE, 'pages'),
};
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.html': 'text/html' };
const etags = new Map();

export function createServer({ csp = process.env.CSP, log = [] } = {}) {
  return http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, If-None-Match');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Content-Encoding, ETag, Last-Modified, Accept-Ranges');
    res.setHeader('Timing-Allow-Origin', '*');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    try {
      const url = new URL(req.url, 'http://x');
      const pathname = decodeURIComponent(url.pathname);
      const prefix = Object.keys(roots).find((p) => pathname.startsWith(p));
      if (!prefix || pathname.includes('..')) { res.writeHead(404); return res.end(); }
      const file = path.join(roots[prefix], pathname.slice(prefix.length));
      const info = await stat(file);
      if (!info.isFile()) { res.writeHead(404); return res.end(); }
      let e = etags.get(file);
      if (!e || e.m !== info.mtimeMs) {
        const h = createHash('sha256');
        for await (const c of createReadStream(file)) h.update(c);
        e = { m: info.mtimeMs, tag: `"${h.digest('hex')}"` };
        etags.set(file, e);
      }
      res.setHeader('ETag', e.tag);
      res.setHeader('Last-Modified', info.mtime.toUTCString());
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', prefix === '/datasets/' ? 'public, max-age=31536000, immutable' : 'no-cache');
      res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
      if (csp && prefix !== '/datasets/') res.setHeader('Content-Security-Policy', csp);
      let start = 0, end = info.size - 1, status = 200;
      const range = req.headers.range;
      if (range) {
        const m = /^bytes=(\d+)-(\d+)?$/.exec(range);
        if (!m) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); return res.end(); }
        start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), info.size - 1) : info.size - 1;
        if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); return res.end(); }
        status = 206;
        res.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`);
      }
      res.setHeader('Content-Length', end - start + 1);
      log.push({ path: url.pathname, method: req.method, range: range ?? null, status, bytes: end - start + 1 });
      res.writeHead(status);
      if (req.method === 'HEAD') return res.end();
      const stream = createReadStream(file, { start, end });
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    } catch (err) {
      if (!res.headersSent) res.writeHead(err.code === 'ENOENT' ? 404 : 500);
      res.end();
    }
  });
}

export function listen(server, port = 0) {
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server.address().port)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = await listen(createServer(), Number(process.env.PORT ?? 8090));
  console.log(`spike range server on http://127.0.0.1:${port}  (datasets: ${DATASETS})`);
}
