// The Node's read path: what is served is what was verified, a changed file is never served under its old tag, and a
// failed check is retried after an interval rather than for the life of the process.
import { mkdtempSync, rmSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { publishRelease } from "./publish.js";
import { ReleaseStore, type ServedFile } from "./store.js";
import { FIXTURE_FILES, fixtureManifest, fixtureStaging } from "./testing/fixture.js";

const NAME = "fixture-2026-10-23";
const folders: string[] = [];
afterEach(() => {
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function published(): Promise<string> {
  const releases = mkdtempSync(join(tmpdir(), "store-releases-"));
  folders.push(releases);
  const staging = fixtureStaging();
  folders.push(staging);
  await publishRelease({
    releasesDir: releases,
    stagingDir: staging,
    manifest: fixtureManifest(NAME, staging),
  });
  return releases;
}

async function body(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

async function whole(file: ServedFile): Promise<Buffer> {
  return body(file.stream(0, file.size - 1));
}

describe("ReleaseStore (story 7.2 review)", () => {
  it("serves the manifest from the bytes it verified, even after the files on disk are replaced", async () => {
    const releases = await published();
    const store = new ReleaseStore(releases);
    const first = await store.lookup(NAME, "manifest.json");
    if (typeof first === "string") throw new Error(first);
    const original = await whole(first);

    writeFileSync(join(releases, NAME, "manifest.json"), '{"release":"replaced"}\n');
    writeFileSync(join(releases, NAME, "manifest.sha512"), "0".repeat(128) + "\n");

    const second = await store.lookup(NAME, "manifest.json");
    if (typeof second === "string") throw new Error(second);
    expect((await whole(second)).equals(original)).toBe(true);
    expect(second.sha512).toBe(first.sha512);
  });

  it("refuses a listed file replaced by one of the same size, and does not serve it under the old tag", async () => {
    const releases = await published();
    const store = new ReleaseStore(releases);
    const before = await store.lookup(NAME, "config.json");
    if (typeof before === "string") throw new Error(before);
    await whole(before);

    const path = join(releases, NAME, "config.json");
    const original = FIXTURE_FILES["config.json"];
    writeFileSync(path, original.replace("true", "tru3"));
    const later = new Date(Date.now() + 60_000);
    utimesSync(path, later, later);

    expect(await store.lookup(NAME, "config.json")).toBe("unchecked");
  });

  it("refuses a symbolic link that replaces a listed name", async () => {
    const releases = await published();
    const outside = mkdtempSync(join(tmpdir(), "store-outside-"));
    folders.push(outside);
    writeFileSync(join(outside, "same.json"), FIXTURE_FILES["config.json"]);
    const store = new ReleaseStore(releases);
    const before = await store.lookup(NAME, "config.json");
    if (typeof before === "string") throw new Error(before);
    await whole(before);

    unlinkSync(join(releases, NAME, "config.json"));
    symlinkSync(join(outside, "same.json"), join(releases, NAME, "config.json"));
    expect(await store.lookup(NAME, "config.json")).toBe("unchecked");
  });

  it("retries a failed check after the retry interval instead of for the life of the process", async () => {
    const releases = await published();
    let clock = 0;
    const store = new ReleaseStore(releases, { now: () => clock, retryFailedAfterMs: 30_000 });

    const path = join(releases, NAME, "graph.tar");
    const good = FIXTURE_FILES["graph.tar"];
    writeFileSync(path, Buffer.from(good.map((b) => b ^ 0x01)));
    expect(await store.lookup(NAME, "graph.tar")).toBe("unchecked");

    writeFileSync(path, good);
    clock = 10_000;
    expect(await store.lookup(NAME, "graph.tar")).toBe("unchecked");

    clock = 30_000;
    const served = await store.lookup(NAME, "graph.tar");
    expect(typeof served).toBe("object");
  });

  it("answers no-release, not unchecked, for a folder with no manifest", async () => {
    const releases = await published();
    const store = new ReleaseStore(releases);
    expect(await store.lookup("nothing-2026", "manifest.json")).toBe("no-release");
  });
});
