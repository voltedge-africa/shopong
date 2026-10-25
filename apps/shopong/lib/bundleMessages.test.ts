import { describe, expect, it } from "vite-plus/test";

import { isReadyMessage } from "./bundleMessages";

describe("isReadyMessage", () => {
  it("accepts a ready message as JSON text or as an object", () => {
    expect(isReadyMessage('{"type":"ready"}')).toBe(true);
    expect(isReadyMessage({ type: "ready" })).toBe(true);
  });

  it.each([
    undefined,
    null,
    1,
    "ready",
    "not json",
    "{}",
    '{"type":"error"}',
    { type: "load" },
    [],
  ])("rejects %j", (raw) => {
    expect(isReadyMessage(raw)).toBe(false);
  });
});
