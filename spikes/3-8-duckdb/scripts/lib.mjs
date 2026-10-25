import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { writeFileSync, mkdirSync } from "node:fs";

export const CHROMIUM =
  process.env.CHROMIUM ?? `${homedir()}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`;

export const launch = (opts = {}) => chromium.launch({ executablePath: CHROMIUM, ...opts });

/** Sum RSS (MB) of the browser process tree. */
export function treeRssMb(pid) {
  try {
    const kids = execSync(`pgrep -P ${pid} || true`).toString().trim().split("\n").filter(Boolean);
    let total = Number(execSync(`awk '/VmRSS/{print $2}' /proc/${pid}/status`).toString() || 0);
    for (const k of kids) total += treeRssMb(Number(k)) * 1024;
    return total / 1024;
  } catch {
    return 0;
  }
}
export function allChromeRssMb() {
  // all processes launched from our chromium binary (renderer, utility, gpu...)
  try {
    const out = execSync(`ps -eo rss,args | grep -F '${CHROMIUM}' | grep -v grep || true`)
      .toString()
      .trim()
      .split("\n")
      .filter(Boolean);
    return out.reduce((a, l) => a + Number(l.trim().split(/\s+/)[0]), 0) / 1024;
  } catch {
    return 0;
  }
}
export function startRssSampler(ms = 100) {
  let peak = 0;
  const h = setInterval(() => (peak = Math.max(peak, allChromeRssMb())), ms);
  return {
    peak: () => Math.round(Math.max(peak, allChromeRssMb())),
    reset: () => (peak = 0),
    stop: () => clearInterval(h),
  };
}

/** Track every network request the page makes, with host classification. */
export function trackRequests(page, origin) {
  const reqs = [];
  page.on("request", (r) =>
    reqs.push({
      url: r.url(),
      type: r.resourceType(),
      external:
        !r.url().startsWith(origin) && !r.url().startsWith("data:") && !r.url().startsWith("blob:"),
    }),
  );
  page.on("requestfailed", (r) => {
    const x = reqs.find((q) => q.url === r.url());
    if (x) x.failed = r.failure()?.errorText;
  });
  page.on("requestfinished", async (r) => {
    const x = reqs.find((q) => q.url === r.url());
    if (!x) return;
    try {
      const s = await r.sizes();
      x.wireBytes = s.responseBodySize;
      const h = await (await r.response())?.allHeaders();
      x.encoding = h?.["content-encoding"] ?? null;
      x.status = (await r.response())?.status();
    } catch {}
  });
  return reqs;
}

export function save(file, obj) {
  mkdirSync("results", { recursive: true });
  writeFileSync(`results/${file}`, JSON.stringify(obj, null, 2) + "\n");
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Per-URL transferred bytes (encodedDataLength, i.e. what crossed the wire) via CDP. */
export async function trackTransfers(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  const byId = new Map();
  const list = [];
  cdp.on("Network.responseReceived", (e) =>
    byId.set(e.requestId, {
      url: e.response.url,
      status: e.response.status,
      encoding:
        e.response.headers["content-encoding"] ?? e.response.headers["Content-Encoding"] ?? null,
      fromCache: e.response.fromDiskCache || e.response.fromServiceWorker || false,
    }),
  );
  cdp.on("Network.loadingFinished", (e) => {
    const r = byId.get(e.requestId);
    if (r) list.push({ ...r, encodedBytes: e.encodedDataLength });
  });
  return { list, cdp };
}
