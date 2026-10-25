import { describe, expect, it } from "vite-plus/test";

import { manifest } from "./index";

describe("shop manifest", () => {
  it("is a web mini app with html and a script that parses", () => {
    const { content } = manifest;
    if (content.kind !== "web") throw new Error("expected a web mini app");
    expect(content.source.html).toContain("ui-");
    // The script runs inside a WebView, where a syntax error only shows up when someone opens it.
    // oxlint-disable-next-line no-implied-eval -- compiles the script to check it; it is never called
    expect(() => new Function(content.source.js ?? "")).not.toThrow();
  });
});
