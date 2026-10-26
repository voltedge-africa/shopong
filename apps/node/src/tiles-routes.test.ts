// The map tile route (story 7.2): read-only, byte ranges, traversal refused, content checked before first use.
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeAll, describe, expect, it } from "vite-plus/test";
import {
  createManifest,
  publishRelease,
  serializeManifest,
  scanFiles,
} from "@shopong/tile-release";
import { buildApp } from "./app.ts";
import { createLogger } from "./logger.ts";
import { captureSink } from "./testing/capture.ts";

const RELEASE = "fixture-2026-10-23";
const GRAPH = Buffer.from("0123456789abcdefghij".repeat(10)); // 200 bytes
const TILE = Buffer.from("tile-bytes");

let releases: string;
let manifestBytes: string;

/** A throwaway release on disk: fake bytes in place of tiles, published through the real publish path. */
const RELEASE_B = "fixture-2026-10-24";
const GRAPH_B = Buffer.from("ABCDEFGHIJKLMNOPQRST".repeat(10));

async function publishFixture(root: string, name: string, graph: Buffer): Promise<string> {
  const staging = mkdtempSync(join(tmpdir(), "tiles-staging-"));
  mkdirSync(join(staging, "tiles/0/000"), { recursive: true });
  writeFileSync(join(staging, "graph.tar"), graph);
  writeFileSync(join(staging, "tiles/0/000/000.gph"), TILE);
  writeFileSync(join(staging, "config.json"), '{"fixture":true}\n');
  const manifest = createManifest({
    release: name,
    region: "fixture-region",
    source: {
      file: "f.osm.pbf",
      url: "https://example.invalid/f.osm.pbf",
      snapshotDate: "2026-10-23",
      sha256: "a".repeat(64),
    },
    coverage: [30, -29.5, 31, -29],
    builder: {
      valhallaVersion: "3.8.3",
      valhallaRevision: "c".repeat(40),
      wrapper: "fixture",
      nativeBuilderSha256: "b".repeat(64),
    },
    attribution: {
      text: "© OpenStreetMap contributors, ODbL 1.0",
      linkText: "© OpenStreetMap contributors (ODbL)",
      url: "https://www.openstreetmap.org/copyright",
      licence: "ODbL 1.0",
      note: "Share-alike position pending counsel.",
    },
    files: scanFiles(staging),
  });
  const bytes = serializeManifest(manifest);
  await publishRelease({ releasesDir: root, stagingDir: staging, manifest });
  rmSync(staging, { recursive: true, force: true });
  return bytes;
}

beforeAll(async () => {
  releases = mkdtempSync(join(tmpdir(), "tiles-routes-"));
  manifestBytes = await publishFixture(releases, RELEASE, GRAPH);
  await publishFixture(releases, RELEASE_B, GRAPH_B);
});

const folders: string[] = [];
afterEach(async () => {
  for (const app of running.splice(0)) await app.close();
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const running: FastifyInstance[] = [];

function serve(
  options: { activeRelease?: string | undefined; dir?: string; cors?: string[] } = {},
): FastifyInstance {
  const app = buildApp({
    logger: createLogger({ level: "info", sink: captureSink() }),
    version: "test",
    components: [],
    tiles: {
      releasesDir: options.dir ?? releases,
      activeRelease: "activeRelease" in options ? options.activeRelease : RELEASE,
    },
    cors: { origins: options.cors ?? [], environment: "production" },
  });
  running.push(app);
  return app;
}

/** A fresh copy of the release, so a test can damage it without touching the shared one. */
function copyRelease(): string {
  const dir = mkdtempSync(join(tmpdir(), "tiles-copy-"));
  folders.push(dir);
  const target = join(dir, RELEASE);
  mkdirSync(join(target, "tiles/0/000"), { recursive: true });
  for (const rel of [
    "graph.tar",
    "config.json",
    "tiles/0/000/000.gph",
    "manifest.json",
    "manifest.sha512",
  ]) {
    writeFileSync(join(target, rel), readFileSync(join(releases, RELEASE, rel)));
  }
  return dir;
}

const sha512 = (bytes: Buffer | string) => createHash("sha512").update(bytes).digest("hex");

describe("GET /map (tile route)", () => {
  it("serves the manifest with the attribution, never cached when it is the active alias", async () => {
    const app = serve();
    const res = await app.inject({ method: "GET", url: "/map/active/manifest.json" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.body).toBe(manifestBytes);
    const body = JSON.parse(res.body) as { attribution: { linkText: string; url: string } };
    expect(body.attribution.linkText).toBe("© OpenStreetMap contributors (ODbL)");
    expect(body.attribution.url).toBe("https://www.openstreetmap.org/copyright");
  });

  it("serves a named release file whole, with its SHA-512 as the ETag and an immutable cache header", async () => {
    const app = serve();
    const res = await app.inject({ method: "GET", url: `/map/${RELEASE}/graph.tar` });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.equals(GRAPH)).toBe(true);
    expect(res.headers["content-type"]).toBe("application/x-tar");
    expect(res.headers["content-length"]).toBe(String(GRAPH.length));
    expect(res.headers["accept-ranges"]).toBe("bytes");
    expect(res.headers["etag"]).toBe(`"${sha512(GRAPH)}"`);
    expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  it("answers a Range request with 206 and the requested bytes", async () => {
    const app = serve();
    const res = await app.inject({
      method: "GET",
      url: `/map/${RELEASE}/graph.tar`,
      headers: { range: "bytes=0-99" },
    });
    expect(res.statusCode).toBe(206);
    expect(res.headers["content-range"]).toBe(`bytes 0-99/${GRAPH.length}`);
    expect(res.headers["content-length"]).toBe("100");
    expect(res.rawPayload.equals(GRAPH.subarray(0, 100))).toBe(true);
  });

  it("answers open-ended and suffix ranges, and a range covering the whole file hashes to the manifest's SHA-512", async () => {
    const app = serve();
    const tail = await app.inject({
      method: "GET",
      url: `/map/${RELEASE}/graph.tar`,
      headers: { range: "bytes=190-" },
    });
    expect(tail.statusCode).toBe(206);
    expect(tail.rawPayload.equals(GRAPH.subarray(190))).toBe(true);
    const suffix = await app.inject({
      method: "GET",
      url: `/map/${RELEASE}/graph.tar`,
      headers: { range: "bytes=-10" },
    });
    expect(suffix.statusCode).toBe(206);
    expect(suffix.rawPayload.equals(GRAPH.subarray(190))).toBe(true);
    const whole = await app.inject({
      method: "GET",
      url: `/map/${RELEASE}/graph.tar`,
      headers: { range: `bytes=0-${GRAPH.length - 1}` },
    });
    expect(sha512(whole.rawPayload)).toBe(sha512(GRAPH));
  });

  it("answers 416 for a range the file cannot meet", async () => {
    const app = serve();
    const res = await app.inject({
      method: "GET",
      url: `/map/${RELEASE}/graph.tar`,
      headers: { range: `bytes=${GRAPH.length}-` },
    });
    expect(res.statusCode).toBe(416);
    expect(res.headers["content-range"]).toBe(`bytes */${GRAPH.length}`);
  });

  it("answers 304 when the client already holds the file", async () => {
    const app = serve();
    const res = await app.inject({
      method: "GET",
      url: `/map/${RELEASE}/graph.tar`,
      headers: { "if-none-match": `"${sha512(GRAPH)}"` },
    });
    expect(res.statusCode).toBe(304);
  });

  it("answers HEAD with the same headers and no body", async () => {
    const app = serve();
    const res = await app.inject({ method: "HEAD", url: `/map/${RELEASE}/graph.tar` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-length"]).toBe(String(GRAPH.length));
    expect(res.rawPayload.length).toBe(0);
  });

  it("serves the active release at the alias and says so when there is none", async () => {
    const active = await serve().inject({ method: "GET", url: "/map/active/config.json" });
    expect(active.statusCode).toBe(200);
    expect(active.headers["cache-control"]).toBe("no-cache");

    const none = serve({ activeRelease: undefined });
    const res = await none.inject({ method: "GET", url: "/map/active/manifest.json" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "no-map-data", message: "No map data yet." });
  });

  it("answers 404 for a release that does not exist, and for a name that is not a release", async () => {
    const app = serve();
    expect(
      (await app.inject({ method: "GET", url: "/map/kwazulu-natal-2026-10-23/manifest.json" }))
        .statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: "GET", url: "/map/Fixture/manifest.json" })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: "GET", url: "/map/.incoming-x/manifest.json" })).statusCode,
    ).toBe(404);
  });

  it("refuses path traversal, encoded traversal and any file the manifest does not list", async () => {
    const app = serve();
    const urls = [
      `/map/${RELEASE}/../../${RELEASE}/manifest.json`,
      `/map/${RELEASE}/tiles/../../secret`,
      `/map/${RELEASE}/%2e%2e%2f%2e%2e%2fsecret`,
      `/map/${RELEASE}/..%2F..%2Fsecret`,
      `/map/..%2F${RELEASE}/manifest.json`,
      `/map/active/.env`,
      `/map/${RELEASE}/secret.txt`,
      `/map/${RELEASE}/tiles`,
      `/map/${RELEASE}/tiles/0/000/%00.gph`,
      `/map/${RELEASE}/`,
    ];
    for (const url of urls) {
      const res = await app.inject({ method: "GET", url });
      expect([400, 404], url).toContain(res.statusCode);
      expect(res.body, url).not.toContain("fixture-region-secret");
    }
  });

  it("is read-only: writes to a release are not routes at all", async () => {
    const app = serve();
    for (const method of ["PUT", "POST", "DELETE"] as const) {
      const res = await app.inject({ method, url: `/map/${RELEASE}/graph.tar`, payload: "x" });
      expect(res.statusCode, method).toBe(404);
    }
  });

  it('refuses a tampered tile with "Map data can\'t be checked." and never serves it', async () => {
    const dir = copyRelease();
    writeFileSync(join(dir, RELEASE, "graph.tar"), "tampered graph");
    const app = serve({ dir });
    const res = await app.inject({ method: "GET", url: `/map/${RELEASE}/graph.tar` });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      error: "map-data-unchecked",
      message: "Map data can't be checked.",
    });
    const manifest = await app.inject({ method: "GET", url: `/map/${RELEASE}/manifest.json` });
    expect(manifest.statusCode).toBe(503);
  });

  it("refuses a changed manifest even when the files are untouched", async () => {
    const dir = copyRelease();
    const text = readFileSync(join(dir, RELEASE, "manifest.json"), "utf8");
    writeFileSync(
      join(dir, RELEASE, "manifest.json"),
      text.replace("fixture-region", "other-region"),
    );
    const app = serve({ dir });
    const res = await app.inject({ method: "GET", url: `/map/${RELEASE}/config.json` });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      error: "map-data-unchecked",
      message: "Map data can't be checked.",
    });
  });

  it("lets the console's origin send Range and read the range headers", async () => {
    const app = serve({ cors: ["https://console.example"] });
    const preflight = await app.inject({
      method: "OPTIONS",
      url: `/map/${RELEASE}/graph.tar`,
      headers: {
        origin: "https://console.example",
        "access-control-request-method": "GET",
        "access-control-request-headers": "range",
      },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers["access-control-allow-headers"]).toContain("range");

    const res = await app.inject({
      method: "GET",
      url: `/map/${RELEASE}/graph.tar`,
      headers: { origin: "https://console.example", range: "bytes=0-9" },
    });
    expect(res.statusCode).toBe(206);
    expect(res.headers["access-control-allow-origin"]).toBe("https://console.example");
    expect(res.headers["access-control-expose-headers"]).toContain("Content-Range");
  });

  it("reports the active release on /ready", async () => {
    const res = await serve().inject({ method: "GET", url: "/ready" });
    expect(res.json()).toMatchObject({ mapRelease: RELEASE });
    const none = await serve({ activeRelease: undefined }).inject({ method: "GET", url: "/ready" });
    expect(none.json()).toMatchObject({ mapRelease: null });
  });

  it("is not registered when no releases folder is configured", async () => {
    const app = buildApp({
      logger: createLogger({ level: "info", sink: captureSink() }),
      version: "test",
      components: [],
    });
    running.push(app);
    expect((await app.inject({ method: "GET", url: "/map/active/manifest.json" })).statusCode).toBe(
      404,
    );
  });

  it("keeps serving the verified manifest after the files on disk are replaced", async () => {
    const dir = copyRelease();
    const app = serve({ dir });
    const first = await app.inject({ method: "GET", url: `/map/${RELEASE}/manifest.json` });
    expect(first.body).toBe(manifestBytes);
    writeFileSync(join(dir, RELEASE, "manifest.json"), '{"release":"replaced"}\n');
    writeFileSync(join(dir, RELEASE, "manifest.sha512"), "0".repeat(128) + "\n");
    const again = await app.inject({ method: "GET", url: `/map/${RELEASE}/manifest.json` });
    expect(again.statusCode).toBe(200);
    expect(again.body).toBe(manifestBytes);
  });

  it("refuses a same-size file replaced after it was checked, and never serves it under the old tag", async () => {
    const dir = copyRelease();
    const app = serve({ dir });
    const first = await app.inject({ method: "GET", url: `/map/${RELEASE}/config.json` });
    expect(first.statusCode).toBe(200);
    const path = join(dir, RELEASE, "config.json");
    writeFileSync(path, '{"fixtude":true}\n');
    const later = new Date(Date.now() + 60_000);
    utimesSync(path, later, later);
    const second = await app.inject({ method: "GET", url: `/map/${RELEASE}/config.json` });
    expect(second.statusCode).toBe(503);
    expect(second.body).not.toContain("fixtude");
  });

  it("refuses a symbolic link that replaces a listed name after the check", async () => {
    const dir = copyRelease();
    const outside = mkdtempSync(join(tmpdir(), "tiles-link-"));
    folders.push(outside);
    writeFileSync(join(outside, "same.json"), '{"fixture":true}\n');
    const app = serve({ dir });
    expect(
      (await app.inject({ method: "GET", url: `/map/${RELEASE}/config.json` })).statusCode,
    ).toBe(200);
    unlinkSync(join(dir, RELEASE, "config.json"));
    symlinkSync(join(outside, "same.json"), join(dir, RELEASE, "config.json"));
    const res = await app.inject({ method: "GET", url: `/map/${RELEASE}/config.json` });
    expect(res.statusCode).toBe(503);
    expect(res.body).not.toContain("fixture");
  });

  it("honours If-Range: a range is answered only when the validator is the current ETag", async () => {
    const current = { name: RELEASE };
    const app = buildApp({
      logger: createLogger({ level: "info", sink: captureSink() }),
      version: "test",
      components: [],
      tiles: {
        releasesDir: releases,
        get activeRelease() {
          return current.name;
        },
      },
    });
    running.push(app);
    const etagA = (await app.inject({ method: "GET", url: "/map/active/graph.tar" })).headers[
      "etag"
    ];
    current.name = RELEASE_B;

    const stale = await app.inject({
      method: "GET",
      url: "/map/active/graph.tar",
      headers: { range: "bytes=0-9", "if-range": etagA as string },
    });
    expect(stale.statusCode).toBe(200);
    expect(stale.rawPayload.equals(GRAPH_B)).toBe(true);

    const etagB = `"${sha512(GRAPH_B)}"`;
    const matching = await app.inject({
      method: "GET",
      url: "/map/active/graph.tar",
      headers: { range: "bytes=0-9", "if-range": etagB },
    });
    expect(matching.statusCode).toBe(206);
    expect(matching.rawPayload.equals(GRAPH_B.subarray(0, 10))).toBe(true);
  });
});
