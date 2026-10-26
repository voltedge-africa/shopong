import { mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { publishRelease } from "./publish.js";
import { verifyRelease } from "./verify.js";
import { writeFiles, fixtureManifest, fixtureStaging } from "./testing/fixture.js";

const folders: string[] = [];
afterEach(() => {
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const NAME = "fixture-2026-10-23";

async function published(): Promise<string> {
  const releases = mkdtempSync(join(tmpdir(), "tile-verify-"));
  folders.push(releases);
  const staging = fixtureStaging();
  folders.push(staging);
  await publishRelease({
    releasesDir: releases,
    stagingDir: staging,
    manifest: fixtureManifest(NAME, staging),
  });
  return join(releases, NAME);
}

describe("verifyRelease", () => {
  it("passes an untouched release", async () => {
    const dir = await published();
    const result = await verifyRelease(dir);
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
  });

  it("refuses a tampered tile", async () => {
    const dir = await published();
    writeFileSync(join(dir, "tiles/0/000/000.gph"), "tampered");
    const result = await verifyRelease(dir);
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("tiles/0/000/000.gph");
  });

  it("refuses a changed manifest, even when the files still match it", async () => {
    const dir = await published();
    const text = readFileSync(join(dir, "manifest.json"), "utf8");
    writeFileSync(join(dir, "manifest.json"), text.replace("fixture-region", "other-region"));
    const result = await verifyRelease(dir);
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toMatch(/manifest/);
  });

  it("refuses a release whose manifest and digest were both replaced by a different release name", async () => {
    const dir = await published();
    const text = readFileSync(join(dir, "manifest.json"), "utf8");
    const renamed = text.replace(`"release": "${NAME}"`, `"release": "other-2026-10-23"`);
    writeFileSync(join(dir, "manifest.json"), renamed);
    const { createHash } = await import("node:crypto");
    writeFileSync(
      join(dir, "manifest.sha512"),
      createHash("sha512").update(renamed).digest("hex") + "\n",
    );
    const result = await verifyRelease(dir);
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("names a different release");
  });

  it("refuses a listed file that is missing", async () => {
    const dir = await published();
    unlinkSync(join(dir, "graph.tar"));
    const result = await verifyRelease(dir);
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("graph.tar");
  });

  it("refuses a file that the manifest does not list", async () => {
    const dir = await published();
    writeFiles(dir, { "tiles/0/000/999.gph": "extra" });
    const result = await verifyRelease(dir);
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("not in the manifest");
  });

  it("refuses a symbolic link in place of a listed file", async () => {
    const dir = await published();
    const outside = mkdtempSync(join(tmpdir(), "tile-outside-"));
    folders.push(outside);
    writeFileSync(join(outside, "secret"), "x");
    unlinkSync(join(dir, "config.json"));
    symlinkSync(join(outside, "secret"), join(dir, "config.json"));
    const result = await verifyRelease(dir);
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("config.json");
  });

  it("refuses a folder with no manifest", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tile-empty-"));
    folders.push(dir);
    const result = await verifyRelease(dir);
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("manifest");
  });

  it("refuses a release whose manifest has no digest file", async () => {
    const dir = await published();
    rmSync(join(dir, "manifest.sha512"));
    const result = await verifyRelease(dir);
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("manifest.sha512");
  });

  it("refuses a listed tile that was removed along with its folder", async () => {
    const dir = await published();
    rmSync(join(dir, "tiles/1"), { recursive: true });
    const result = await verifyRelease(dir);
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("tiles/1/000/001.gph");
  });
});
