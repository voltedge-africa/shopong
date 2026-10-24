import { describe, expect, it } from "vite-plus/test";
import { createLogger } from "./logger.ts";
import { createScrubber, looksLikeSecretKey, REDACTED, redactObject } from "./redact.ts";
import { captureSink, FAKE_SECRETS } from "./testing/capture.ts";

describe("looksLikeSecretKey", () => {
  it.each([
    "password",
    "STITCH_CLIENT_SECRET",
    "accessToken",
    "apiKey",
    "api_key",
    "LEDFRA_API_TOKEN",
    "signingKey",
    "authorization",
    "Cookie",
    "client_id",
    "STABLECOIN_SIGNING_KEY",
  ])("flags %s", (key) => expect(looksLikeSecretKey(key)).toBe(true));

  it.each(["url", "port", "components", "msg", "host", "level"])("leaves %s", (key) =>
    expect(looksLikeSecretKey(key)).toBe(false),
  );
});

describe("redactObject", () => {
  it("replaces whole subtrees under secret-looking keys, at any depth", () => {
    const out = redactObject({
      a: 1,
      auth: { token: "t1", nested: ["x"] },
      deep: { list: [{ password: "p" }, { ok: true }] },
    });
    expect(out).toEqual({
      a: 1,
      auth: { token: REDACTED, nested: ["x"] },
      deep: { list: [{ password: REDACTED }, { ok: true }] },
    });
  });

  it("survives cycles", () => {
    const a: Record<string, unknown> = { name: "a" };
    a["self"] = a;
    expect(JSON.stringify(redactObject(a))).toContain("[Circular]");
  });
});

describe("createScrubber", () => {
  it("replaces secret values wherever they appear, including JSON-escaped", () => {
    const scrub = createScrubber(['q"uote-secret', "plain-secret-value"]);
    const line = JSON.stringify({ msg: 'boom q"uote-secret and plain-secret-value' });
    expect(scrub(line)).not.toContain("uote-secret");
    expect(scrub(line)).not.toContain("plain-secret-value");
  });

  it("ignores very short values", () => {
    expect(createScrubber(["ab"])("abab")).toBe("abab");
  });
});

describe("createLogger", () => {
  it("redacts secret-looking keys and scrubs known values from messages and errors", () => {
    const sink = captureSink();
    const logger = createLogger({
      level: "info",
      secretValues: [FAKE_SECRETS.LEDFRA_API_TOKEN],
      sink,
    });
    logger.info(
      { apiKey: "should-not-appear-1", child: { client_secret: "should-not-appear-2" } },
      "hello",
    );
    logger.info(`message embeds ${FAKE_SECRETS.LEDFRA_API_TOKEN}`);
    logger.error(new Error(`failed with ${FAKE_SECRETS.LEDFRA_API_TOKEN}`));
    logger.child({ password: "should-not-appear-3" }).info("child");

    const text = sink.text();
    for (const leaked of [
      "should-not-appear-1",
      "should-not-appear-2",
      "should-not-appear-3",
      FAKE_SECRETS.LEDFRA_API_TOKEN,
    ]) {
      expect(text).not.toContain(leaked);
    }
    expect(text).toContain(REDACTED);
    expect(sink.lines.every((l) => JSON.parse(l).service === "ocn-node")).toBe(true);
  });
});
