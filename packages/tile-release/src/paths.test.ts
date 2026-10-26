import { describe, expect, it } from "vite-plus/test";
import { isSafeReleaseName, isSafeRelativePath, parseByteRange, contentTypeFor } from "./paths.js";

describe("release names", () => {
  it("accepts lowercase names with digits, dots and hyphens", () => {
    expect(isSafeReleaseName("kwazulu-natal-2026-10-23")).toBe(true);
    expect(isSafeReleaseName("rehearsal.eswatini-1")).toBe(true);
  });
  it("refuses traversal, case, separators, the reserved alias and dotfiles", () => {
    for (const bad of [
      "",
      "..",
      "../x",
      "a/b",
      "a\\b",
      "Upper",
      "active",
      ".hidden",
      "a..b",
      "x".repeat(81),
      "sp ace",
      "a\0b",
    ]) {
      expect(isSafeReleaseName(bad), bad).toBe(false);
    }
  });
});

describe("relative file paths", () => {
  it("accepts nested tile paths", () => {
    expect(isSafeRelativePath("graph.tar")).toBe(true);
    expect(isSafeRelativePath("tiles/0/000/001.gph")).toBe(true);
  });
  it("refuses traversal, absolute paths, backslashes, control bytes, empty and dot segments", () => {
    const bad = [
      "",
      "../secret",
      "tiles/../../secret",
      "/etc/passwd",
      "tiles//x.gph",
      "tiles/./x.gph",
      "tiles\\..\\x",
      "a\0b",
      "a\nb",
      ".env",
      "tiles/.hidden",
      "x".repeat(256),
    ];
    for (const path of bad) expect(isSafeRelativePath(path), JSON.stringify(path)).toBe(false);
  });
});

describe("byte ranges", () => {
  const size = 1000;
  it("answers no header with the whole file", () => {
    expect(parseByteRange(undefined, size)).toEqual({ kind: "full" });
  });
  it("answers a closed range with 206 bounds", () => {
    expect(parseByteRange("bytes=0-99", size)).toEqual({ kind: "partial", start: 0, end: 99 });
    expect(parseByteRange("bytes=10-10", size)).toEqual({ kind: "partial", start: 10, end: 10 });
  });
  it("clamps an end past the file and answers open-ended and suffix ranges", () => {
    expect(parseByteRange("bytes=900-5000", size)).toEqual({
      kind: "partial",
      start: 900,
      end: 999,
    });
    expect(parseByteRange("bytes=990-", size)).toEqual({ kind: "partial", start: 990, end: 999 });
    expect(parseByteRange("bytes=-100", size)).toEqual({ kind: "partial", start: 900, end: 999 });
    expect(parseByteRange("bytes=-5000", size)).toEqual({ kind: "partial", start: 0, end: 999 });
  });
  it("refuses a start past the end, an empty suffix and an empty file", () => {
    expect(parseByteRange("bytes=1000-", size)).toEqual({ kind: "unsatisfiable" });
    expect(parseByteRange("bytes=-0", size)).toEqual({ kind: "unsatisfiable" });
    expect(parseByteRange("bytes=0-0", 0)).toEqual({ kind: "unsatisfiable" });
  });
  it("ignores a malformed, reversed or multi-range header and serves the whole file", () => {
    expect(parseByteRange("bytes=5-3", size)).toEqual({ kind: "full" });
    expect(parseByteRange("bytes=0-1,5-6", size)).toEqual({ kind: "full" });
    expect(parseByteRange("items=0-1", size)).toEqual({ kind: "full" });
    expect(parseByteRange("bytes=abc", size)).toEqual({ kind: "full" });
  });
});

describe("content types", () => {
  it("maps the release file kinds and defaults to octet-stream", () => {
    expect(contentTypeFor("manifest.json")).toBe("application/json");
    expect(contentTypeFor("graph.tar")).toBe("application/x-tar");
    expect(contentTypeFor("tiles/0/000/000.gph")).toBe("application/octet-stream");
    expect(contentTypeFor("weird.bin")).toBe("application/octet-stream");
  });
});
