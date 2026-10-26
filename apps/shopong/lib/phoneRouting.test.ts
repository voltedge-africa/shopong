// The phone bundle carries no routing engine (AGENTS rule 7; decision 7.1). A grep-style check of the app's own source
// and of the adapters' barrel: the straight-line routing class is not reachable from the app, and the barrel does not
// export it (patch of story 7.4). The Android export is the real check; this keeps the import graph from regressing.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const APP = fileURLToPath(new URL("..", import.meta.url));
const REPO = join(APP, "..", "..");
const FORBIDDEN = [
  "MemoryRouting",
  "encodePolyline6",
  "StraightLineRouting",
  "adapters-memory/routing",
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules") return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("the phone's import graph", () => {
  it("names no routing engine in the app's source", () => {
    for (const dir of ["app", "components", "lib"]) {
      for (const file of sourceFiles(join(APP, dir))) {
        const text = readFileSync(file, "utf8");
        for (const word of FORBIDDEN) expect(text, `${file} names ${word}`).not.toContain(word);
      }
    }
  });

  it("has an adapters barrel that does not export the routing adapter", () => {
    const barrel = readFileSync(
      join(REPO, "packages", "adapters-memory", "src", "index.ts"),
      "utf8",
    );
    expect(barrel).not.toContain("routing");
  });
});
