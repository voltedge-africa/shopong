// The adapter's own acceptance checks, beyond the port's contract: replica convergence under different
// arrival orders, restart, and the clock and randomness kept out of `apply`.
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { contractDefinition, testEventId, type ContractEvent } from "@shopong/ports-contract";
import type { Did, Space, SpaceDefinition } from "@shopong/ports";
import { openAutobaseRecord, type AutobaseSharedRecord } from "./index.js";
import { applyNodesForTest, baseOf } from "./record.js";
import { replicatePair } from "./test-support.js";

const records: AutobaseSharedRecord<ContractEvent>[] = [];
const dirs: string[] = [];
afterAll(async () => {
  for (const record of records) await record.close();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function dataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "record-adapter-"));
  dirs.push(dir);
  return dir;
}

async function node(
  local: string,
  masterKey: Uint8Array,
  folder: string = dataDir(),
): Promise<AutobaseSharedRecord<ContractEvent>> {
  const record = await openAutobaseRecord<ContractEvent>({
    local: local as Did,
    dataDir: folder,
    masterKey,
  });
  records.push(record);
  return record;
}

/** The whole view, canonical: every key and value in key order, hashed with SHA-512. */
async function digest(space: Space<ContractEvent>): Promise<string> {
  await space.update();
  const lines: string[] = [];
  for await (const entry of baseOf(space).view.createReadStream()) {
    lines.push(JSON.stringify([entry.key, entry.value]));
  }
  return createHash("sha512").update(lines.join("\n")).digest("hex");
}

/** A small xorshift, so each run of the convergence test replays the same arrival orders. */
function rng(seed: number): () => number {
  let x = seed;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0x100000000;
  };
}

describe("convergence", () => {
  it("replicas that hear the same entries in different orders have identical views", async () => {
    const master = randomBytes(32);
    const tag = "prop";
    for (const seed of [7, 19, 101]) {
      const pick = rng(seed);
      const a = await (await node(`did:test:creator-${seed}`, master)).create(contractDefinition);
      const b = await (await node(`did:test:b-${seed}`, master)).open(a.key, contractDefinition);
      const c = await (await node(`did:test:c-${seed}`, master)).open(a.key, contractDefinition);
      expect((await a.append({ kind: "admit", tag, writer: b.local })).ok).toBe(true);
      expect((await a.append({ kind: "admit", tag, writer: c.local })).ok).toBe(true);
      await replicatePair(a, b);
      await replicatePair(a, c);

      // Conflicting offline writes, including the same key from every writer.
      for (const [space, name] of [
        [a, "a"],
        [b, "b"],
        [c, "c"],
      ] as const) {
        await space.append({ kind: "put", tag, key: "shared", value: `${name}-${seed}` });
        await space.append({ kind: "put", tag, key: `own/${name}`, value: pick() });
      }

      // Two readers that hear about the writers in a random order.
      const readers = [
        await (await node(`did:test:r1-${seed}`, master)).open(a.key, contractDefinition),
        await (await node(`did:test:r2-${seed}`, master)).open(a.key, contractDefinition),
      ];
      const everyone = [a, b, c, ...readers];
      for (let round = 0; round < 6; round++) {
        const i = Math.floor(pick() * everyone.length);
        const j = Math.floor(pick() * everyone.length);
        if (i !== j) await replicatePair(everyone[i]!, everyone[j]!);
      }
      // Finish with a full mesh (each pair once; a replication exchanges both ways), so every replica holds every entry.
      for (let i = 0; i < everyone.length; i++) {
        for (let j = i + 1; j < everyone.length; j++)
          await replicatePair(everyone[i]!, everyone[j]!);
      }

      const digests = new Set<string>();
      for (const space of everyone) digests.add(await digest(space));
      expect(digests.size, `seed ${seed}`).toBe(1);
      // Every entry (two admissions, six writes) reached the contract's apply exactly once.
      expect(await a.view.get("meta/count"), `seed ${seed}`).toBe(8);
    }
  }, 300_000);
});

describe("restart", () => {
  it("the view, the writers and every event are still there after the Node is stopped and started", async () => {
    const master = randomBytes(32);
    const folder = dataDir();
    const tag = "restart";
    const first = await node("did:test:node", master, folder);
    const space = await first.create(contractDefinition);
    const key = space.key;
    await space.append({ kind: "put", tag, key: "greeting", value: "sawubona" });
    await space.append({ kind: "admit", tag, writer: "did:test:member" as Did });
    await space.update();
    const before = await digest(space);
    await first.close();

    const second = await node("did:test:node", master, folder);
    const again = await second.open(key, contractDefinition);
    expect(await again.writers()).toEqual(["did:test:member", "did:test:node"]);
    expect(await again.view.get("kv/greeting")).toEqual({ value: "sawubona", by: "did:test:node" });
    expect(await again.writable()).toBe(true);
    expect(await digest(again)).toBe(before);
    expect((await again.append({ kind: "put", tag, key: "later", value: 2 })).ok).toBe(true);
    expect(await again.view.get("kv/later")).toEqual({ value: 2, by: "did:test:node" });
  });

  it("refuses to open a data folder with a different master key", async () => {
    const folder = dataDir();
    const first = await node("did:test:x", randomBytes(32), folder);
    await first.create(contractDefinition);
    await first.close();
    await expect(
      openAutobaseRecord({
        local: "did:test:x" as Did,
        dataDir: folder,
        masterKey: randomBytes(32),
      }),
    ).rejects.toThrow();
  });
});

describe("apply stays deterministic", () => {
  /** An in-memory view and host, so an `apply` runs with no Autobase underneath it. */
  function memory() {
    const data = new Map<string, unknown>();
    return {
      data,
      view: {
        get: async (key: string) => data.get(key) as never,
        list: async (prefix: string) =>
          [...data.keys()]
            .sort()
            .filter((k) => k.startsWith(prefix))
            .map((key) => ({ key, value: data.get(key) as never })),
        put: async (key: string, value: never) => {
          data.set(key, value);
        },
        del: async (key: string) => {
          data.delete(key);
        },
      },
      host: {
        addWriter: async () => {},
        removeWriter: async () => {},
      },
    };
  }

  /** Run `fn` with the clock and the random source replaced by functions that throw. */
  async function withTrappedClockAndRandom<T>(fn: () => Promise<T>): Promise<T> {
    const realNow = Date.now;
    const realRandom = Math.random;
    const boom = (): never => {
      throw new Error("apply read the clock or randomness");
    };
    Date.now = boom;
    Math.random = boom;
    try {
      return await fn();
    } finally {
      Date.now = realNow;
      Math.random = realRandom;
    }
  }

  it("the contract's apply reads neither the clock nor randomness", async () => {
    const { view, host, data } = memory();
    const entries = [
      {
        id: testEventId("admit"),
        writer: "did:test:a" as Did,
        event: { kind: "admit", tag: "t", writer: "did:test:b" } as ContractEvent,
      },
      {
        id: testEventId("put"),
        writer: "did:test:b" as Did,
        event: { kind: "put", tag: "t", key: "k", value: 1 } as ContractEvent,
      },
    ];
    await withTrappedClockAndRandom(async () => {
      for (const entry of entries) await contractDefinition.apply([entry], view, host);
    });
    expect(data.get("meta/count")).toBe(2);
    expect(data.get("kv/k")).toEqual({ value: 1, by: "did:test:b" });
  });

  it("a clock read inside apply fails it, so the trap is real", async () => {
    const { view, host } = memory();
    const impure: SpaceDefinition<ContractEvent>["apply"] = async () => {
      Date.now();
    };
    await expect(withTrappedClockAndRandom(() => impure([], view, host))).rejects.toThrow(
      "apply read the clock or randomness",
    );
    expect(Date.now()).toBeGreaterThan(1_700_000_000_000);
  });
});

describe("re-admission", () => {
  it("a removed writer that is admitted again has its entries linearised in every replica", async () => {
    const master = randomBytes(32);
    const tag = "readmit";
    const a = await (await node("did:test:owner-readmit", master)).create(contractDefinition);
    const b = await (await node("did:test:bob-readmit", master)).open(a.key, contractDefinition);
    const r = await (await node("did:test:reader-readmit", master)).open(a.key, contractDefinition);
    const mesh = async () => {
      for (const [x, y] of [
        [a, b],
        [a, r],
        [b, r],
      ] as const) {
        await replicatePair(x, y);
      }
    };

    expect((await a.append({ kind: "admit", tag, writer: b.local })).ok).toBe(true);
    await mesh();
    expect((await b.append({ kind: "put", tag, key: "before", value: 1 })).ok).toBe(true);
    await mesh();

    expect((await a.append({ kind: "remove", tag, writer: b.local })).ok).toBe(true);
    await mesh();
    expect(await b.writable()).toBe(false);

    // A second admission with the same content would have the same event id, so it gets its own tag.
    const again = await a.append({ kind: "admit", tag: `${tag}-again`, writer: b.local });
    expect(again).toMatchObject({ ok: true, value: { duplicate: false } });
    await mesh();
    expect(await b.writable()).toBe(true);
    expect((await b.append({ kind: "put", tag, key: "after", value: 2 })).ok).toBe(true);
    await mesh();

    for (const space of [a, b, r]) {
      expect(await space.view.get("kv/after"), space.local).toEqual({ value: 2, by: b.local });
    }
  }, 120_000);
});

describe("apply guards", () => {
  /** A Hyperbee-like view in memory, so guarded writes can be checked key by key. */
  function memoryView() {
    const data = new Map<string, unknown>();
    return {
      data,
      get: async (key: string) => (data.has(key) ? { key, value: data.get(key) } : null),
      put: async (key: string, value: unknown) => {
        data.set(key, value);
      },
      del: async (key: string) => {
        data.delete(key);
      },
      createReadStream: async function* (options: { gte: string }) {
        for (const key of [...data.keys()].sort()) {
          if (key >= options.gte) yield { key, value: data.get(key) };
        }
      },
    };
  }
  const host = { addWriter: async () => {}, removeWriter: async () => {}, removeable: () => true };

  async function spied(master: Uint8Array) {
    const applied: { id: string; writer: string }[] = [];
    const definition: SpaceDefinition<ContractEvent> = {
      eventId: (event) => testEventId(event),
      apply: async (entries) => {
        for (const entry of entries) applied.push({ id: entry.id, writer: entry.writer });
      },
    };
    const space = await (await node("did:test:guard-owner", master)).create(definition);
    return { space, applied };
  }

  const bob = "did:test:guard-bob" as Did;
  const event: ContractEvent = { kind: "put", tag: "guard", key: "k", value: 1 };
  const id = testEventId(event);
  const keyOfBob = Buffer.alloc(32, 9);
  const hexOfBob = keyOfBob.toString("hex");

  it("an entry from a core key with no DID in the view is skipped and never applied", async () => {
    const { space, applied } = await spied(randomBytes(32));
    const view = memoryView();
    await applyNodesForTest(
      space,
      [{ value: { t: "event", id, event }, from: { key: keyOfBob } }],
      view,
      host,
    );
    expect(applied).toEqual([]);
    expect(view.data.has(`_sys/logged/${id}`)).toBe(false);
  });

  it("an entry whose stored id does not match the event's id is skipped", async () => {
    const { space, applied } = await spied(randomBytes(32));
    const view = memoryView();
    view.data.set(`_sys/owner/${hexOfBob}`, bob);
    view.data.set(`_sys/writer/${bob}`, true);
    const forged = testEventId("forged");
    await applyNodesForTest(
      space,
      [{ value: { t: "event", id: forged, event }, from: { key: keyOfBob } }],
      view,
      host,
    );
    expect(applied).toEqual([]);
    await applyNodesForTest(
      space,
      [{ value: { t: "event", id, event }, from: { key: keyOfBob } }],
      view,
      host,
    );
    expect(applied).toEqual([{ id, writer: bob }]);
  });

  it("an unadmitted writer does not consume an event id", async () => {
    const { space, applied } = await spied(randomBytes(32));
    const view = memoryView();
    view.data.set(`_sys/owner/${hexOfBob}`, bob); // known to the view, but not admitted now
    await applyNodesForTest(
      space,
      [{ value: { t: "event", id, event }, from: { key: keyOfBob } }],
      view,
      host,
    );
    expect(view.data.has(`_sys/logged/${id}`)).toBe(false);
    view.data.set(`_sys/writer/${bob}`, true); // admitted later
    await applyNodesForTest(
      space,
      [{ value: { t: "event", id, event }, from: { key: keyOfBob } }],
      view,
      host,
    );
    expect(applied).toEqual([{ id, writer: bob }]);
  });

  it("a DID that was never admitted is refused by the port, through the adapter", async () => {
    const master = randomBytes(32);
    const owner = await (await node("did:test:port-owner", master)).create(contractDefinition);
    const outsider = await (
      await node("did:test:port-outsider", master)
    ).open(owner.key, contractDefinition);
    const refused = await outsider.append({ kind: "put", tag: "port", key: "k", value: 1 });
    expect(refused).toMatchObject({ ok: false, error: { code: "not_writable" } });
  });
});

describe("file permissions", () => {
  it("creates the data folder for its owner only, and the space index for its owner only", async () => {
    const folder = join(dataDir(), "fresh");
    const record = await node("did:test:perms", randomBytes(32), folder);
    await record.create(contractDefinition);
    expect(statSync(folder).mode & 0o777).toBe(0o700);
    expect(statSync(join(folder, "spaces.json")).mode & 0o777).toBe(0o600);
  });
});

describe("removal in Autobase (story 3.3)", () => {
  it("Autobase removes a writer, refuses to remove its last indexer, and the creator stays admitted", async () => {
    const master = randomBytes(32);
    const tag = "autobase-removal";
    const a = await (await node("did:test:owner-ab", master)).create(contractDefinition);
    const b = await (await node("did:test:bob-ab", master)).open(a.key, contractDefinition);
    expect((await a.append({ kind: "admit", tag, writer: b.local })).ok).toBe(true);
    await replicatePair(a, b);

    /** The writer key the adapter recorded for a DID (kept in the view after removal, for re-admission). */
    const writerKey = async (did: string) => {
      const node = await baseOf(a).view.get(`_sys/key/${did}`);
      return Buffer.from(node.value as string, "hex");
    };
    const creatorKey = await writerKey(a.local);
    const bobKey = await writerKey(b.local);

    // Two indexers (the creator and bob): either may be removed.
    expect(baseOf(a).removeable(bobKey)).toBe(true);
    expect(baseOf(a).removeable(creatorKey)).toBe(true);

    expect((await a.append({ kind: "remove", tag, writer: b.local })).ok).toBe(true);
    await replicatePair(a, b);
    expect(await a.writers()).toEqual([a.local]);
    expect(await b.writable()).toBe(false);
    // The creator is now the only indexer, so Autobase refuses to remove it.
    expect(baseOf(a).removeable(creatorKey)).toBe(false);

    // The creator is never removed, even when named, and stays admitted.
    await a.append({ kind: "remove", tag: `${tag}-creator`, writer: a.local });
    await a.update();
    expect(await a.writable()).toBe(true);
    expect(await a.writers()).toEqual([a.local]);
    // The writer key of bob is kept, so a fresh admission can use it again.
    expect(await writerKey(b.local)).toEqual(bobKey);
  }, 120_000);
});
