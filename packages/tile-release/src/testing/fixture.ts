// A small fake release for tests: a few bytes in place of tiles. Nothing here is map data.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createManifest, serializeManifest, type ManifestInput } from "../manifest.js";
import { scanFiles } from "../verify.js";

export const FIXTURE_ATTRIBUTION = {
  text: "© OpenStreetMap contributors, ODbL 1.0",
  linkText: "© OpenStreetMap contributors (ODbL)",
  url: "https://www.openstreetmap.org/copyright",
  licence: "ODbL 1.0",
  note: "Share-alike position pending counsel.",
};

/** Writes the fake files under `dir`, creating folders as needed. */
export function writeFiles(dir: string, files: Record<string, string | Buffer>): void {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
}

export const FIXTURE_FILES = {
  "graph.tar": Buffer.from("fake-graph-tar-bytes-0123456789".repeat(8)),
  "config.json": '{"fixture":true}\n',
  "tiles/0/000/000.gph": Buffer.from("tile-zero-bytes"),
  "tiles/1/000/001.gph": Buffer.from("tile-one-bytes-are-a-little-longer"),
};

/** A staging folder with the fixture files, returned as its path. */
export function fixtureStaging(files: Record<string, string | Buffer> = FIXTURE_FILES): string {
  const dir = mkdtempSync(join(tmpdir(), "tile-staging-"));
  writeFiles(dir, files);
  return dir;
}

/** The manifest input for a staging folder, with the fixture's provenance. */
export function fixtureManifest(
  release: string,
  staging: string,
  overrides: Partial<ManifestInput> = {},
) {
  return createManifest({
    release,
    region: "fixture-region",
    source: {
      file: "fixture.osm.pbf",
      url: "https://example.invalid/fixture.osm.pbf",
      snapshotDate: "2026-10-23",
      sha256: "a".repeat(64),
    },
    coverage: [30.0, -29.5, 31.0, -29.0],
    builder: {
      valhallaVersion: "3.8.3",
      valhallaRevision: "c".repeat(40),
      wrapper: "fixture",
      nativeBuilderSha256: "b".repeat(64),
    },
    attribution: FIXTURE_ATTRIBUTION,
    files: scanFiles(staging),
    ...overrides,
  });
}

export function fixtureManifestBytes(release: string, staging: string): string {
  return serializeManifest(fixtureManifest(release, staging));
}
