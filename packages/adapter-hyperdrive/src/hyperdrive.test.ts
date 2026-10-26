import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { runFileStoreContract } from "@shopong/ports-contract";
import { asSha512Hex, type Sha512Hex } from "@shopong/ports";
import { HyperdriveFileStores } from "./index.js";

const MASTER = new Uint8Array(32).fill(7);
const dirs: string[] = [];
const newDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "ocn-files-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// The shared FileStore contract, run on Hyperdrive: one store per factory call, in its own folder.
runFileStoreContract(async () => {
  const stores = await HyperdriveFileStores.open({ dataDir: newDir(), masterKey: MASTER });
  const files = await stores.of("a".repeat(64));
  return { files, absent: asSha512Hex("cd".repeat(64)) };
});

describe("HyperdriveFileStores", () => {
  it("keeps bytes across a reopen of the same folder", async () => {
    const dataDir = newDir();
    const hash = asSha512Hex("ef".repeat(64)) as Sha512Hex;
    const first = await HyperdriveFileStores.open({ dataDir, masterKey: MASTER });
    await (await first.of("b".repeat(64))).put(hash, new Uint8Array([1, 2, 3]));
    await first.close();

    const second = await HyperdriveFileStores.open({ dataDir, masterKey: MASTER });
    const files = await second.of("b".repeat(64));
    const got = await files.get(hash);
    expect(got.ok).toBe(true);
    if (got.ok) expect(Array.from(got.value)).toEqual([1, 2, 3]);
    await second.close();
  });

  it("gives each community its own files", async () => {
    const dataDir = newDir();
    const stores = await HyperdriveFileStores.open({ dataDir, masterKey: MASTER });
    const hash = asSha512Hex("12".repeat(64)) as Sha512Hex;
    await (await stores.of("c".repeat(64))).put(hash, new Uint8Array([9]));
    expect(await (await stores.of("d".repeat(64))).has(hash)).toBe(false);
    await stores.close();
  });
});

describe("review patch: a failed open is not kept", () => {
  it("retries the Corestore on the next call after its first open fails (item 9)", async () => {
    const dataDir = newDir();
    let calls = 0;
    const stores = await HyperdriveFileStores.open({
      dataDir,
      masterKey: MASTER,
      openCorestore: (dir, options) => {
        calls += 1;
        if (calls === 1) throw new Error("the store is locked");
        // The real package, once the first attempt has failed.
        return new (createRequire(import.meta.url)("corestore") as new (
          d: string,
          o: Record<string, unknown>,
        ) => never)(dir, options);
      },
    });
    await expect(stores.of("e".repeat(64))).rejects.toThrow("the store is locked");
    const files = await stores.of("e".repeat(64));
    expect(await files.bytesHeld()).toBe(0);
    expect(calls).toBe(2);
    await stores.close();
  });

  it("reports the size of a held file and the bytes held in total", async () => {
    const dataDir = newDir();
    const stores = await HyperdriveFileStores.open({ dataDir, masterKey: MASTER });
    const files = await stores.of("f".repeat(64));
    const hash = asSha512Hex("34".repeat(64));
    await files.put(hash, new Uint8Array([1, 2, 3, 4]));
    expect(await files.sizeOf(hash)).toBe(4);
    expect(await files.bytesHeld()).toBe(4);
    await stores.close();
  });
});
