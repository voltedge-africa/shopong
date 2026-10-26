import { describe, expect, it } from "vite-plus/test";
import { nodeAddressOf } from "./nodeAddress";

const production = { development: false };
const development = { development: true };

describe("the OCN Node address (story 3.4 Q4, review P10)", () => {
  it("is refused when the build sets none, in plain words", () => {
    expect(nodeAddressOf(undefined, production)).toEqual({
      ok: false,
      reason: "No OCN Node is set for this build.",
    });
    expect(nodeAddressOf("   ", production).ok).toBe(false);
  });

  it("accepts HTTPS and drops a trailing slash, in any build", () => {
    expect(nodeAddressOf("https://node.ocn.example/", production)).toEqual({
      ok: true,
      url: "https://node.ocn.example",
    });
    expect(nodeAddressOf("https://node.ocn.example/", development).ok).toBe(true);
  });

  it("refuses plain HTTP in a release build, even for localhost and the emulator's host (review P10)", () => {
    for (const url of [
      "http://localhost:8787",
      "http://127.0.0.1:8787",
      "http://10.0.2.2:8787",
      "http://node.example.org",
    ]) {
      const refused = nodeAddressOf(url, production);
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.reason).toContain("HTTPS");
    }
  });

  it("accepts plain HTTP for localhost, 127.0.0.1 and the emulator's host in a development build", () => {
    expect(nodeAddressOf("http://10.0.2.2:8787", development)).toEqual({
      ok: true,
      url: "http://10.0.2.2:8787",
    });
    expect(nodeAddressOf("http://localhost:8787", development).ok).toBe(true);
    expect(nodeAddressOf("http://127.0.0.1:8787", development).ok).toBe(true);
    // Plain HTTP to any other host is refused even in development.
    expect(nodeAddressOf("http://node.example.org:8787", development).ok).toBe(false);
  });

  it("refuses a path, a query or a non-web address without echoing it", () => {
    expect(nodeAddressOf("https://node.example/api", production).ok).toBe(false);
    const bad = nodeAddressOf("not a url secret-token", production);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).not.toContain("secret-token");
  });
});
