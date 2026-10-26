import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { publishRelease, ReleaseExistsError } from "./publish.js";
import { serializeManifest } from "./manifest.js";
import { verifyRelease } from "./verify.js";
import { FIXTURE_FILES, fixtureManifest, fixtureStaging, writeFiles } from "./testing/fixture.js";

const folders: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "tile-releases-"));
  folders.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("publishRelease", () => {
  it("creates a release that verifies", async () => {
    const releases = scratch();
    const staging = fixtureStaging();
    const manifest = fixtureManifest("fixture-2026-10-23", staging);
    const result = await publishRelease({ releasesDir: releases, stagingDir: staging, manifest });
    expect(result.status).toBe("created");
    expect(await verifyRelease(join(releases, "fixture-2026-10-23"))).toMatchObject({ ok: true });
  });

  it("leaves a rebuild under the same name and the same bytes unchanged", async () => {
    const releases = scratch();
    const staging = fixtureStaging();
    const manifest = fixtureManifest("fixture-2026-10-23", staging);
    await publishRelease({ releasesDir: releases, stagingDir: staging, manifest });
    const before = readFileSync(join(releases, "fixture-2026-10-23", "manifest.json"), "utf8");
    const again = await publishRelease({
      releasesDir: releases,
      stagingDir: fixtureStaging(),
      manifest: fixtureManifest("fixture-2026-10-23", staging),
    });
    expect(again.status).toBe("unchanged");
    expect(readFileSync(join(releases, "fixture-2026-10-23", "manifest.json"), "utf8")).toBe(
      before,
    );
    expect(readdirSync(releases)).toEqual(["fixture-2026-10-23"]);
  });

  it("refuses a rebuild under an existing name with different bytes and leaves the release untouched", async () => {
    const releases = scratch();
    const staging = fixtureStaging();
    await publishRelease({
      releasesDir: releases,
      stagingDir: staging,
      manifest: fixtureManifest("fixture-2026-10-23", staging),
    });
    const before = readFileSync(join(releases, "fixture-2026-10-23", "graph.tar"));

    const changed = fixtureStaging({
      ...FIXTURE_FILES,
      "graph.tar": Buffer.from("different bytes"),
    });
    const attempt = publishRelease({
      releasesDir: releases,
      stagingDir: changed,
      manifest: fixtureManifest("fixture-2026-10-23", changed),
    });
    await expect(attempt).rejects.toBeInstanceOf(ReleaseExistsError);
    await expect(attempt).rejects.toThrow("Release fixture-2026-10-23 already exists.");
    expect(readFileSync(join(releases, "fixture-2026-10-23", "graph.tar"))).toEqual(before);
    expect(await verifyRelease(join(releases, "fixture-2026-10-23"))).toMatchObject({ ok: true });
    expect(readdirSync(releases)).toEqual(["fixture-2026-10-23"]);
  });

  it("refuses a changed attribution under an existing name even when the files are the same", async () => {
    const releases = scratch();
    const staging = fixtureStaging();
    await publishRelease({
      releasesDir: releases,
      stagingDir: staging,
      manifest: fixtureManifest("fixture-2026-10-23", staging),
    });
    const edited = fixtureManifest("fixture-2026-10-23", staging, {
      attribution: { ...fixtureManifest("x", staging).attribution, linkText: "changed" },
    });
    await expect(
      publishRelease({ releasesDir: releases, stagingDir: staging, manifest: edited }),
    ).rejects.toThrow("Release fixture-2026-10-23 already exists.");
  });

  it("refuses a staging folder that does not match the manifest, and writes nothing", async () => {
    const releases = scratch();
    const staging = fixtureStaging();
    const manifest = fixtureManifest("fixture-2026-10-23", staging);
    writeFileSync(join(staging, "graph.tar"), "changed after the manifest was made");
    await expect(
      publishRelease({ releasesDir: releases, stagingDir: staging, manifest }),
    ).rejects.toThrow("do not match the manifest");
    expect(existsSync(join(releases, "fixture-2026-10-23"))).toBe(false);
    expect(readdirSync(releases)).toEqual([]);
  });

  it("refuses a release name that is not safe, before anything is written", async () => {
    const releases = scratch();
    const staging = fixtureStaging();
    // The manifest itself refuses the name, so no release object can even be made.
    expect(() => fixtureManifest("../escape", staging)).toThrow("Release name is not allowed.");
    expect(readdirSync(releases)).toEqual([]);
  });

  it("writes manifest.json exactly as serialised, with its digest beside it", async () => {
    const releases = scratch();
    const staging = fixtureStaging();
    const manifest = fixtureManifest("fixture-2026-10-23", staging);
    await publishRelease({ releasesDir: releases, stagingDir: staging, manifest });
    const dir = join(releases, "fixture-2026-10-23");
    expect(readFileSync(join(dir, "manifest.json"), "utf8")).toBe(serializeManifest(manifest));
    expect(readFileSync(join(dir, "manifest.sha512"), "utf8").trim()).toHaveLength(128);
  });

  it("refuses a staging folder that already holds a reserved manifest file", async () => {
    const releases = scratch();
    const staging = fixtureStaging();
    writeFiles(staging, { "manifest.json": "{}" });
    expect(() => fixtureManifest("fixture-2026-10-23", staging)).toThrow(/reserved/);
    expect(readdirSync(releases)).toEqual([]);
  });

  it("refuses a file added to the staging folder between the scan and the copy, and leaves no folder behind", async () => {
    const releases = scratch();
    const staging = fixtureStaging();
    const manifest = fixtureManifest("fixture-2026-10-23", staging);
    await expect(
      publishRelease({
        releasesDir: releases,
        stagingDir: staging,
        manifest,
        seams: { afterStagingScan: () => writeFileSync(join(staging, "late.gph"), "late") },
      }),
    ).rejects.toThrow("do not match the manifest");
    expect(readdirSync(releases)).toEqual([]);
  });

  it("refuses a symbolic link that appears in the staging folder after the scan", async () => {
    const releases = scratch();
    const staging = fixtureStaging();
    const outside = scratch();
    writeFileSync(join(outside, "secret"), "x");
    const manifest = fixtureManifest("fixture-2026-10-23", staging);
    await expect(
      publishRelease({
        releasesDir: releases,
        stagingDir: staging,
        manifest,
        seams: {
          afterStagingScan: () => symlinkSync(join(outside, "secret"), join(staging, "link.gph")),
        },
      }),
    ).rejects.toThrow();
    expect(readdirSync(releases)).toEqual([]);
  });
});
