import { describe, expect, it } from "vite-plus/test";
import { loadConfig } from "./config.ts";
import { ConfigError, ResolvedSecrets, SECRET_DEFINITIONS } from "./secrets.ts";
import { FAKE_SECRETS } from "./testing/capture.ts";

const files = (map: Record<string, string>) => (path: string) => {
  const text = map[path];
  if (text === undefined) throw Object.assign(new Error("nope"), { code: "ENOENT" });
  return text;
};

function failure(fn: () => unknown): ConfigError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return error as ConfigError;
  }
  throw new Error("expected loadConfig to throw");
}

describe("loadConfig", () => {
  it("starts with no file and no secrets: record and queue on, ledger and payments off", () => {
    const { config } = loadConfig({ env: {} });
    expect(config.server).toEqual({ host: "127.0.0.1", port: 8787 });
    expect(config.components).toEqual({
      record: { enabled: true },
      ledger: { enabled: false },
      payments: { enabled: false },
      queue: { enabled: true },
    });
  });

  it("layers file over defaults and environment over file", () => {
    const readFile = files({
      "/c.json": JSON.stringify({
        server: { port: 9000 },
        logLevel: "debug",
        components: { queue: { enabled: false } },
      }),
    });
    const fromFile = loadConfig({ env: { OCN_NODE_CONFIG: "/c.json" }, readFile }).config;
    expect(fromFile.server.port).toBe(9000);
    expect(fromFile.logLevel).toBe("debug");
    expect(fromFile.components.queue.enabled).toBe(false);

    const fromEnv = loadConfig({
      env: {
        OCN_NODE_CONFIG: "/c.json",
        OCN_NODE_PORT: "9100",
        OCN_NODE_QUEUE_ENABLED: "true",
        OCN_NODE_LOG_LEVEL: "warn",
      },
      readFile,
    }).config;
    expect(fromEnv.server.port).toBe(9100);
    expect(fromEnv.components.queue.enabled).toBe(true);
    expect(fromEnv.logLevel).toBe("warn");
  });

  it("lets --config win over OCN_NODE_CONFIG", () => {
    const readFile = files({
      "/a.json": JSON.stringify({ server: { port: 1111 } }),
      "/b.json": JSON.stringify({ server: { port: 2222 } }),
    });
    const { config } = loadConfig({
      env: { OCN_NODE_CONFIG: "/a.json" },
      configPath: "/b.json",
      readFile,
    });
    expect(config.server.port).toBe(2222);
  });

  it("rejects unknown keys and bad values without echoing them", () => {
    const readFile = files({
      "/bad.json": JSON.stringify({ server: { port: "not-a-number-xyz" }, bogus: true }),
    });
    const error = failure(() => loadConfig({ env: { OCN_NODE_CONFIG: "/bad.json" }, readFile }));
    expect(error.message).toContain("bogus");
    expect(error.message).toContain("server.port");
    expect(error.message).not.toContain("not-a-number-xyz");
  });

  it("rejects an invalid port in the environment", () => {
    expect(failure(() => loadConfig({ env: { OCN_NODE_PORT: "99999" } })).message).toContain(
      "OCN_NODE_PORT",
    );
  });

  it("reports unreadable and malformed config files by path only", () => {
    expect(
      failure(() => loadConfig({ env: { OCN_NODE_CONFIG: "/missing.json" }, readFile: files({}) }))
        .message,
    ).toContain("ENOENT");
    const readFile = files({ "/x.json": '{"a": "super-secret-looking-text' });
    const error = failure(() => loadConfig({ env: { OCN_NODE_CONFIG: "/x.json" }, readFile }));
    expect(error.message).toContain("not valid JSON");
    expect(error.message).not.toContain("super-secret-looking-text");
  });
});

describe("secrets (AC 1.5a)", () => {
  const allOn = {
    OCN_NODE_LEDGER_ENABLED: "true",
    OCN_NODE_PAYMENTS_ENABLED: "true",
  };

  it("names every missing required secret and no values", () => {
    const error = failure(() =>
      loadConfig({
        env: {
          ...allOn,
          // STITCH_CLIENT_SECRET and LEDFRA_API_TOKEN are missing; the third is present.
          STITCH_CLIENT_ID: FAKE_SECRETS.STITCH_CLIENT_ID,
        },
      }),
    );
    expect(error.keys).toEqual(["LEDFRA_API_TOKEN", "STITCH_CLIENT_SECRET"]);
    expect(error.message).toContain("STITCH_CLIENT_SECRET");
    expect(error.message).toContain("LEDFRA_API_TOKEN");
    expect(error.message).not.toContain(FAKE_SECRETS.STITCH_CLIENT_ID);
  });

  it("treats an empty value as missing", () => {
    const error = failure(() =>
      loadConfig({ env: { OCN_NODE_LEDGER_ENABLED: "true", LEDFRA_API_TOKEN: "" } }),
    );
    expect(error.keys).toEqual(["LEDFRA_API_TOKEN"]);
  });

  it("requires only the secrets of enabled components", () => {
    const { secrets } = loadConfig({
      env: { OCN_NODE_LEDGER_ENABLED: "true", LEDFRA_API_TOKEN: "abcd1234" },
    });
    expect(secrets.keys()).toEqual(["LEDFRA_API_TOKEN"]);
  });

  it("never requires the optional placeholders, but loads them when present", () => {
    const { secrets } = loadConfig({
      env: { STABLECOIN_SIGNING_KEY: FAKE_SECRETS.STABLECOIN_SIGNING_KEY },
    });
    expect(secrets.has("STABLECOIN_SIGNING_KEY")).toBe(true);
    expect(
      SECRET_DEFINITIONS.filter((d) =>
        ["STABLECOIN_SIGNING_KEY", "LLM_API_KEY"].includes(d.key),
      ).every((d) => !d.required),
    ).toBe(true);
  });

  it("reads KEY_FILE and strips the trailing newline", () => {
    const { secrets } = loadConfig({
      env: { OCN_NODE_LEDGER_ENABLED: "true", LEDFRA_API_TOKEN_FILE: "/run/secrets/ledfra" },
      readSecretFile: (p) => (p === "/run/secrets/ledfra" ? "from-file-token\n" : ""),
    });
    expect(secrets.get("LEDFRA_API_TOKEN")).toBe("from-file-token");
  });

  it("refuses an unreadable secret file, naming the key and error code only", () => {
    const error = failure(() =>
      loadConfig({
        env: { OCN_NODE_LEDGER_ENABLED: "true", LEDFRA_API_TOKEN_FILE: "/nope" },
        readSecretFile: () => {
          throw Object.assign(new Error("ENOENT: secret-in-message"), { code: "ENOENT" });
        },
      }),
    );
    expect(error.message).toContain("LEDFRA_API_TOKEN_FILE");
    expect(error.message).toContain("ENOENT");
    expect(error.message).not.toContain("secret-in-message");
  });

  it("refuses a key set both directly and as a file", () => {
    const error = failure(() =>
      loadConfig({
        env: { LLM_API_KEY: "direct-value", LLM_API_KEY_FILE: "/x" },
        readSecretFile: () => "x",
      }),
    );
    expect(error.keys).toEqual(["LLM_API_KEY"]);
    expect(error.message).not.toContain("direct-value");
  });

  it("refuses a config file that carries a secret, at any depth, without echoing it", () => {
    const readFile = files({
      "/c.json": JSON.stringify({
        components: { payments: { enabled: true } },
        extra: { nested: { STITCH_CLIENT_SECRET: "leaky-value-123456" } },
        apiKey: "another-leaky-654321",
      }),
    });
    const error = failure(() => loadConfig({ env: { OCN_NODE_CONFIG: "/c.json" }, readFile }));
    expect(error.keys).toEqual(["STITCH_CLIENT_SECRET", "apiKey"]);
    expect(error.message).not.toContain("leaky-value-123456");
    expect(error.message).not.toContain("another-leaky-654321");
  });

  it("does not leak values when a ResolvedSecrets is serialised or inspected", async () => {
    const { secrets } = loadConfig({ env: { LLM_API_KEY: FAKE_SECRETS.LLM_API_KEY } });
    expect(secrets).toBeInstanceOf(ResolvedSecrets);
    const { inspect } = await import("node:util");
    expect(JSON.stringify(secrets)).not.toContain(FAKE_SECRETS.LLM_API_KEY);
    expect(inspect(secrets)).not.toContain(FAKE_SECRETS.LLM_API_KEY);
    expect(String(JSON.stringify({ secrets }))).toContain("LLM_API_KEY");
  });
});
