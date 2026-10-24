import { afterEach, describe, expect, it } from "vite-plus/test";
import { startNode, type RunningNode } from "./node.ts";
import { captureSink, FAKE_SECRETS } from "./testing/capture.ts";

let running: RunningNode | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

const ephemeral = { OCN_NODE_PORT: "0" };

describe("a running Node (AC 1.5b)", () => {
  it("answers GET /health with per-component status, overall status and version", async () => {
    running = await startNode({ env: ephemeral, sink: captureSink() });
    const res = await fetch(`${running.url}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "ok",
      version: "0.0.0",
      components: {
        record: { status: "ok", mode: "in-memory" },
        ledger: { status: "disabled" },
        payments: { status: "disabled" },
        queue: { status: "ok", mode: "in-memory" },
      },
    });
  });

  it("reports enabled components as ok once their secrets are present", async () => {
    running = await startNode({
      env: {
        ...ephemeral,
        OCN_NODE_LEDGER_ENABLED: "true",
        OCN_NODE_PAYMENTS_ENABLED: "true",
        LEDFRA_API_TOKEN: FAKE_SECRETS.LEDFRA_API_TOKEN,
        STITCH_CLIENT_ID: FAKE_SECRETS.STITCH_CLIENT_ID,
        STITCH_CLIENT_SECRET: FAKE_SECRETS.STITCH_CLIENT_SECRET,
      },
      sink: captureSink(),
    });
    const body = (await (await fetch(`${running.url}/health`)).json()) as {
      components: Record<string, { status: string }>;
    };
    expect(Object.values(body.components).map((c) => c.status)).toEqual(["ok", "ok", "ok", "ok"]);
  });

  it("answers GET /ready with 200 when ready", async () => {
    running = await startNode({ env: ephemeral, sink: captureSink() });
    const res = await fetch(`${running.url}/ready`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ready: true, status: "ok" });
  });

  it("answers 404 for unknown routes", async () => {
    running = await startNode({ env: ephemeral, sink: captureSink() });
    expect((await fetch(`${running.url}/nope`)).status).toBe(404);
  });

  it("stops listening on close", async () => {
    const node = await startNode({ env: ephemeral, sink: captureSink() });
    await node.close();
    await expect(fetch(`${node.url}/health`)).rejects.toThrow();
  });

  it("never writes any secret value to its logs, including through requests", async () => {
    const sink = captureSink();
    running = await startNode({
      env: {
        ...ephemeral,
        OCN_NODE_LEDGER_ENABLED: "true",
        OCN_NODE_PAYMENTS_ENABLED: "true",
        ...FAKE_SECRETS,
      },
      sink,
    });
    await fetch(`${running.url}/health`, {
      headers: { authorization: `Bearer ${FAKE_SECRETS.LEDFRA_API_TOKEN}` },
    });
    await fetch(`${running.url}/ready?token=${FAKE_SECRETS.LLM_API_KEY}`);
    await running.close();
    running = undefined;
    const text = sink.text();
    expect(text).toContain("ocn node listening");
    for (const value of Object.values(FAKE_SECRETS)) expect(text).not.toContain(value);
  });
});
