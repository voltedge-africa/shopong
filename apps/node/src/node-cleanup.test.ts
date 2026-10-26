// If the Node fails after the record has opened, the record must be closed, so its lock is released.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it, vi } from "vite-plus/test";
import { openAutobaseRecord } from "@shopong/record-autobase";
import type { Did } from "@shopong/ports";
import { startNode } from "./node.ts";
import { captureSink, FAKE_SECRETS } from "./testing/capture.ts";

vi.mock("./app.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("./app.ts")>();
  return {
    ...real,
    buildApp: () => {
      throw new Error("boom: the app could not be built");
    },
  };
});

const folder = mkdtempSync(join(tmpdir(), "ocn-node-cleanup-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

it("closes the record when the app cannot be built after the record opened", async () => {
  await expect(
    startNode({
      env: {
        OCN_NODE_PORT: "0",
        OCN_NODE_DATA_DIR: folder,
        RECORD_MASTER_KEY: FAKE_SECRETS.RECORD_MASTER_KEY,
      },
      sink: captureSink(),
    }),
  ).rejects.toThrow("boom");

  // The record's files are locked while it is open; a second open succeeds only if the first was closed.
  const again = await openAutobaseRecord({
    local: "did:ocn:cleanup" as Did,
    dataDir: join(folder, "record"),
    masterKey: Buffer.from(FAKE_SECRETS.RECORD_MASTER_KEY, "hex"),
  });
  await again.close();
});
