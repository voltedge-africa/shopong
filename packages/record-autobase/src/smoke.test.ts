// Smoke test (story 3.2, question 1): one event through Autobase and Hyperbee on Node 24, view read back.
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import b4a from "b4a";

const requireCjs = createRequire(import.meta.url);
const Autobase = requireCjs("autobase");
const Corestore = requireCjs("corestore");
const Hyperbee = requireCjs("hyperbee");

it("runs one event through Autobase and Hyperbee and reads the view back", async () => {
  const dir = mkdtempSync(join(tmpdir(), "record-smoke-"));
  const store = new Corestore(dir);
  try {
    const base = new Autobase(store.namespace("space"), null, {
      valueEncoding: "json",
      ackInterval: 0,
      open: (s: any) =>
        new Hyperbee(s.get({ name: "view" }), { keyEncoding: "utf-8", valueEncoding: "json" }),
      apply: async (nodes: any[], view: any) => {
        for (const node of nodes) {
          if (node.value === null) continue;
          await view.put(`kv/${node.value.key}`, node.value.value);
        }
      },
    });
    await base.ready();
    expect(base.writable).toBe(true);
    await base.append({ key: "greeting", value: "sawubona" });
    await base.update();
    const got = await base.view.get("kv/greeting");
    expect(got?.value).toBe("sawubona");
    expect(b4a.isBuffer(base.key)).toBe(true);
    await base.close();
  } finally {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);
