// Removing the picker's own cached copy (review item 10, web regression). The web build must never call expo-file-system:
// the helper takes the platform and the file calls as inputs, so the test can make any call throw.
import { describe, expect, it } from "vite-plus/test";
import { discardPickedCopy, readPickedBytes } from "./pickedCopy";

const CACHE = "file:///data/user/0/app/cache/";

describe("discardPickedCopy", () => {
  it("never calls the file system on web (it would throw there)", async () => {
    const boom = () => {
      throw new Error("expo-file-system is not supported on web");
    };
    const removed = await discardPickedCopy(`${CACHE}ImagePicker/a.jpg`, {
      isWeb: true,
      cacheUri: boom,
      removeFile: boom,
    });
    expect(removed).toBe(false);
  });

  it("removes a copy in the app cache on native", async () => {
    const removed: string[] = [];
    const ok = await discardPickedCopy(`${CACHE}ImagePicker/a.jpg`, {
      isWeb: false,
      cacheUri: async () => CACHE,
      removeFile: async (uri) => {
        removed.push(uri);
      },
    });
    expect(ok).toBe(true);
    expect(removed).toEqual([`${CACHE}ImagePicker/a.jpg`]);
  });

  it("never removes a file outside the app cache", async () => {
    const removed: string[] = [];
    const ok = await discardPickedCopy("file:///storage/emulated/0/DCIM/keep.jpg", {
      isWeb: false,
      cacheUri: async () => CACHE,
      removeFile: async (uri) => {
        removed.push(uri);
      },
    });
    expect(ok).toBe(false);
    expect(removed).toEqual([]);
  });

  it("a failing cleanup resolves to false and never throws", async () => {
    const ok = await discardPickedCopy(`${CACHE}a.jpg`, {
      isWeb: false,
      cacheUri: async () => CACHE,
      removeFile: async () => {
        throw new Error("disk busy");
      },
    });
    expect(ok).toBe(false);
  });
});

// The modules a web build loads must not import expo-file-system as a value: a static import runs on web as well.
import { readFileSync } from "node:fs";
describe("web never loads expo-file-system (review patch 2)", () => {
  for (const file of ["../components/OrdersHost.tsx", "./attachmentStore.ts", "./pickedCopy.ts"]) {
    it(`${file} has no value import of expo-file-system`, () => {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      const valueImports = source
        .split("\n")
        .filter((line) => /^import\s(?!type\s)[^;]*from\s+"expo-file-system"/.test(line));
      expect(valueImports).toEqual([]);
    });
  }
});

describe("readPickedBytes", () => {
  it("reads through fetch on web", async () => {
    const bytes = await readPickedBytes("blob:http://x/1", {
      isWeb: true,
      fetchBytes: async () => new Uint8Array([1, 2]),
      readFile: async () => {
        throw new Error("expo-file-system is not supported on web");
      },
    });
    expect([...bytes]).toEqual([1, 2]);
  });

  it("reads the picker's file with the file system on native, never through fetch (fetch cannot open the picker's double-encoded path and answers the text 'File not found')", async () => {
    const bytes = await readPickedBytes(
      "file:///cache/%2540anonymous%252Fshopong/ImagePicker/a.png",
      {
        isWeb: false,
        fetchBytes: async () => new TextEncoder().encode("File not found"),
        readFile: async () => new Uint8Array([0x89, 0x50]),
      },
    );
    expect([...bytes]).toEqual([0x89, 0x50]);
  });
});
