// Browser access to the Node (story 3.4): preflights and headers for configured origins only, and never a wildcard
// outside development. Real HTTP through `startNode`.
import { afterEach, describe, expect, it } from "vite-plus/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allowedOrigin, ALLOWED_HEADERS } from "./cors.ts";
import { startNode, type RunningNode } from "./node.ts";
import { captureSink, FAKE_SECRETS } from "./testing/capture.ts";

let running: RunningNode | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

async function start(extra: Record<string, string>): Promise<RunningNode> {
  running = await startNode({
    env: {
      OCN_NODE_PORT: "0",
      OCN_NODE_DATA_DIR: mkdtempSync(join(tmpdir(), "ocn-cors-")),
      RECORD_MASTER_KEY: FAKE_SECRETS.RECORD_MASTER_KEY,
      ...extra,
    },
    sink: captureSink(),
  });
  return running;
}

const preflight = (node: RunningNode, origin: string) =>
  fetch(`${node.url}/communities`, {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type,x-ocn-signature,x-ocn-actor",
    },
  });

describe("CORS for browsers (story 3.4)", () => {
  it("answers a preflight from a configured origin with the headers a signed request needs", async () => {
    const node = await start({ OCN_NODE_CORS_ORIGINS: "https://app.example" });
    const res = await preflight(node, "https://app.example");
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://app.example");
    const allowed = res.headers.get("access-control-allow-headers") ?? "";
    for (const name of ALLOWED_HEADERS) expect(allowed).toContain(name);
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it("gives a configured origin its header on an ordinary response", async () => {
    const node = await start({ OCN_NODE_CORS_ORIGINS: "https://app.example" });
    const res = await fetch(`${node.url}/health`, { headers: { origin: "https://app.example" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("https://app.example");
  });

  it("sends no allow-origin for an origin that is not configured", async () => {
    const node = await start({ OCN_NODE_CORS_ORIGINS: "https://app.example" });
    const res = await preflight(node, "https://evil.example");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    const plain = await fetch(`${node.url}/health`, {
      headers: { origin: "https://evil.example" },
    });
    expect(plain.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("sends no CORS headers at all when no origin is configured", async () => {
    const node = await start({});
    const res = await fetch(`${node.url}/health`, { headers: { origin: "https://app.example" } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("answers a wildcard only in development", async () => {
    const dev = await start({ OCN_NODE_ENVIRONMENT: "development", OCN_NODE_CORS_ORIGINS: "*" });
    expect(
      (await preflight(dev, "http://localhost:8081")).headers.get("access-control-allow-origin"),
    ).toBe("*");
    await dev.close();
    running = undefined;
  });

  it("never answers a wildcard in production, even if one is passed in directly", () => {
    expect(
      allowedOrigin({ origins: ["*"], environment: "production" }, "https://x.example"),
    ).toBeUndefined();
    expect(allowedOrigin({ origins: ["*"], environment: "development" }, "https://x.example")).toBe(
      "*",
    );
    expect(
      allowedOrigin({ origins: ["https://a.example"], environment: "production" }, undefined),
    ).toBeUndefined();
  });
});
