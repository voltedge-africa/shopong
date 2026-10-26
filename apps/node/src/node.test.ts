import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vite-plus/test";
import type { EventId, SpaceDefinition } from "@shopong/ports";
import { ConfigError } from "./secrets.ts";
import { startNode, type RunningNode } from "./node.ts";
import { captureSink, FAKE_SECRETS } from "./testing/capture.ts";

let running: RunningNode | undefined;
// Each test gets its own data folder: the record's files are locked while a Node runs.
const folders: string[] = [];
const freshFolder = (): string => {
  const folder = mkdtempSync(join(tmpdir(), "ocn-node-data-"));
  folders.push(folder);
  return folder;
};

afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

afterEach(async () => {
  await running?.close();
  running = undefined;
});

/** Ephemeral port, a data folder of its own, and the record key. */
const ephemeral = (): Record<string, string> => ({
  OCN_NODE_PORT: "0",
  OCN_NODE_DATA_DIR: freshFolder(),
  RECORD_MASTER_KEY: FAKE_SECRETS.RECORD_MASTER_KEY,
});

interface Note {
  readonly key: string;
  readonly value: string;
}

/** A small definition for the restart check: each note is stored under its key; its id is SHA-512 of its JSON. */
const definition: SpaceDefinition<unknown> = {
  eventId: (event) => createHash("sha512").update(JSON.stringify(event)).digest("hex") as EventId,
  apply: async (entries, view) => {
    for (const { event } of entries) {
      const note = event as Note;
      await view.put(`kv/${note.key}`, note.value);
    }
  },
};

describe("a running Node (AC 1.5b)", () => {
  it("answers GET /health with per-component status, overall status and version", async () => {
    running = await startNode({ env: ephemeral(), sink: captureSink() });
    const res = await fetch(`${running.url}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "ok",
      version: "0.0.0",
      components: {
        record: { status: "ok", mode: "autobase" },
        ledger: { status: "disabled" },
        payments: { status: "disabled" },
        queue: { status: "ok", mode: "in-memory" },
      },
    });
  });

  it("reports enabled components as ok once their secrets are present", async () => {
    running = await startNode({
      env: {
        ...ephemeral(),
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

  it("refuses to start without the record master key (AC 1.5a)", async () => {
    await expect(
      startNode({
        env: { OCN_NODE_PORT: "0", OCN_NODE_DATA_DIR: freshFolder() },
        sink: captureSink(),
      }),
    ).rejects.toThrow(ConfigError);
  });

  it("refuses to start with the .env.example placeholder, in a plain message", async () => {
    const error = await startNode({
      env: {
        OCN_NODE_PORT: "0",
        OCN_NODE_DATA_DIR: freshFolder(),
        RECORD_MASTER_KEY: "replace-with-64-hex-characters",
      },
      sink: captureSink(),
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).message).toContain("not a placeholder");
  });

  it("keeps a community's events on the data folder, across a stop and a start", async () => {
    const folder = freshFolder();
    const env = { ...ephemeral(), OCN_NODE_DATA_DIR: folder };
    const first = await startNode({ env, sink: captureSink() });
    const record = first.record;
    if (record === undefined) throw new Error("the record component is on by default");
    const space = await record.create(definition);
    expect((await space.append({ key: "greeting", value: "sawubona" })).ok).toBe(true);
    const key = space.key;
    await first.close();

    running = await startNode({ env, sink: captureSink() });
    const again = await running.record?.open(key, definition);
    expect(await again?.view.get("kv/greeting")).toBe("sawubona");
  });

  it("answers GET /ready with 200 when ready", async () => {
    running = await startNode({ env: ephemeral(), sink: captureSink() });
    const res = await fetch(`${running.url}/ready`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ready: true, status: "ok" });
  });

  it("answers 404 for unknown routes", async () => {
    running = await startNode({ env: ephemeral(), sink: captureSink() });
    expect((await fetch(`${running.url}/nope`)).status).toBe(404);
  });

  it("stops listening on close", async () => {
    const node = await startNode({ env: ephemeral(), sink: captureSink() });
    await node.close();
    await expect(fetch(`${node.url}/health`)).rejects.toThrow();
  });

  it("never writes any secret value to its logs, including through requests", async () => {
    const sink = captureSink();
    running = await startNode({
      env: {
        ...ephemeral(),
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
