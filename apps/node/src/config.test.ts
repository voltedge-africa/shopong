import { describe, expect, it } from "vite-plus/test";
import { loadConfig } from "./config.ts";
import { ConfigError, ResolvedSecrets, SECRET_DEFINITIONS } from "./secrets.ts";
import { FAKE_SECRETS } from "./testing/capture.ts";

// The record is on by default, so every load that does not switch it off needs its master key.
const RECORD = { RECORD_MASTER_KEY: FAKE_SECRETS.RECORD_MASTER_KEY };

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
  it("starts with no file and only the record key: record and queue on, ledger and payments off", () => {
    const { config } = loadConfig({ env: RECORD });
    expect(config.server).toEqual({ host: "127.0.0.1", port: 8787 });
    expect(config.dataDir).toBe("ocn-data");
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
        dataDir: "/from/file",
        components: { queue: { enabled: false } },
      }),
    });
    const fromFile = loadConfig({
      env: { ...RECORD, OCN_NODE_CONFIG: "/c.json" },
      readFile,
    }).config;
    expect(fromFile.dataDir).toBe("/from/file");
    expect(fromFile.server.port).toBe(9000);
    expect(fromFile.logLevel).toBe("debug");
    expect(fromFile.components.queue.enabled).toBe(false);

    const fromEnv = loadConfig({
      env: {
        ...RECORD,
        OCN_NODE_DATA_DIR: "/from/env",
        OCN_NODE_CONFIG: "/c.json",
        OCN_NODE_PORT: "9100",
        OCN_NODE_QUEUE_ENABLED: "true",
        OCN_NODE_LOG_LEVEL: "warn",
      },
      readFile,
    }).config;
    expect(fromEnv.server.port).toBe(9100);
    expect(fromEnv.dataDir).toBe("/from/env");
    expect(fromEnv.components.queue.enabled).toBe(true);
    expect(fromEnv.logLevel).toBe("warn");
  });

  it("lets --config win over OCN_NODE_CONFIG", () => {
    const readFile = files({
      "/a.json": JSON.stringify({ server: { port: 1111 } }),
      "/b.json": JSON.stringify({ server: { port: 2222 } }),
    });
    const { config } = loadConfig({
      env: { ...RECORD, OCN_NODE_CONFIG: "/a.json" },
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
    expect(
      failure(() => loadConfig({ env: { ...RECORD, OCN_NODE_PORT: "99999" } })).message,
    ).toContain("OCN_NODE_PORT");
  });

  it("reports unreadable and malformed config files by path only", () => {
    expect(
      failure(() =>
        loadConfig({ env: { ...RECORD, OCN_NODE_CONFIG: "/missing.json" }, readFile: files({}) }),
      ).message,
    ).toContain("ENOENT");
    const readFile = files({ "/x.json": '{"a": "super-secret-looking-text' });
    const error = failure(() =>
      loadConfig({ env: { ...RECORD, OCN_NODE_CONFIG: "/x.json" }, readFile }),
    );
    expect(error.message).toContain("not valid JSON");
    expect(error.message).not.toContain("super-secret-looking-text");
  });
});

describe("secrets (AC 1.5a)", () => {
  const allOn = {
    ...RECORD,
    OCN_NODE_LEDGER_ENABLED: "true",
    OCN_NODE_PAYMENTS_ENABLED: "true",
  };

  it("refuses to start without the record master key, naming the key and no value", () => {
    const error = failure(() => loadConfig({ env: {} }));
    expect(error.keys).toEqual(["RECORD_MASTER_KEY"]);
    expect(error.message).toContain("RECORD_MASTER_KEY");
  });

  it("names every missing required secret and no values", () => {
    const error = failure(() =>
      loadConfig({
        env: {
          ...allOn,
          // SIMULATED_WEBHOOK_SECRET is missing. The Stitch secrets are not needed while the payments adapter is the
          // simulation, so a value that is present here is not echoed. The ledger needs no secret (AD-22).
          STITCH_CLIENT_ID: FAKE_SECRETS.STITCH_CLIENT_ID,
        },
      }),
    );
    expect(error.keys).toEqual(["SIMULATED_WEBHOOK_SECRET"]);
    expect(error.message).toContain("SIMULATED_WEBHOOK_SECRET");
    expect(error.message).not.toContain("LEDFRA");
    expect(error.message).not.toContain("STITCH_CLIENT_SECRET");
    expect(error.message).not.toContain(FAKE_SECRETS.STITCH_CLIENT_ID);
  });

  it("treats an empty value as missing", () => {
    const error = failure(() =>
      loadConfig({
        env: { ...RECORD, OCN_NODE_PAYMENTS_ENABLED: "true", SIMULATED_WEBHOOK_SECRET: "" },
      }),
    );
    expect(error.keys).toEqual(["SIMULATED_WEBHOOK_SECRET"]);
  });

  it("starts the ledger with no Ledfra token: the books are the Node's own SQLite file (AD-22)", () => {
    const { secrets, config } = loadConfig({ env: { ...RECORD, OCN_NODE_LEDGER_ENABLED: "true" } });
    expect(config.components.ledger.enabled).toBe(true);
    expect(secrets.keys()).toEqual(["RECORD_MASTER_KEY"]);
    expect(secrets.has("LEDFRA_API_TOKEN")).toBe(false);
  });

  it("never requires the optional placeholders, but loads them when present", () => {
    const { secrets } = loadConfig({
      env: { ...RECORD, STABLECOIN_SIGNING_KEY: FAKE_SECRETS.STABLECOIN_SIGNING_KEY },
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
      env: {
        ...RECORD,
        OCN_NODE_PAYMENTS_ENABLED: "true",
        SIMULATED_WEBHOOK_SECRET_FILE: "/run/secrets/simulated",
        OCN_NODE_ALLOW_SIMULATED_PAYMENTS: "true",
      },
      readSecretFile: (p) => (p === "/run/secrets/simulated" ? "from-file-key\n" : ""),
    });
    expect(secrets.get("SIMULATED_WEBHOOK_SECRET")).toBe("from-file-key");
  });

  it("refuses an unreadable secret file, naming the key and error code only", () => {
    const error = failure(() =>
      loadConfig({
        env: {
          ...RECORD,
          OCN_NODE_PAYMENTS_ENABLED: "true",
          SIMULATED_WEBHOOK_SECRET_FILE: "/nope",
        },
        readSecretFile: () => {
          throw Object.assign(new Error("ENOENT: secret-in-message"), { code: "ENOENT" });
        },
      }),
    );
    expect(error.message).toContain("SIMULATED_WEBHOOK_SECRET_FILE");
    expect(error.message).toContain("ENOENT");
    expect(error.message).not.toContain("secret-in-message");
  });

  it("refuses a key set both directly and as a file", () => {
    const error = failure(() =>
      loadConfig({
        env: { ...RECORD, LLM_API_KEY: "direct-value", LLM_API_KEY_FILE: "/x" },
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
    const error = failure(() =>
      loadConfig({ env: { ...RECORD, OCN_NODE_CONFIG: "/c.json" }, readFile }),
    );
    expect(error.keys).toEqual(["STITCH_CLIENT_SECRET", "apiKey"]);
    expect(error.message).not.toContain("leaky-value-123456");
    expect(error.message).not.toContain("another-leaky-654321");
  });

  it("does not leak values when a ResolvedSecrets is serialised or inspected", async () => {
    const { secrets } = loadConfig({ env: { ...RECORD, LLM_API_KEY: FAKE_SECRETS.LLM_API_KEY } });
    expect(secrets).toBeInstanceOf(ResolvedSecrets);
    const { inspect } = await import("node:util");
    expect(JSON.stringify(secrets)).not.toContain(FAKE_SECRETS.LLM_API_KEY);
    expect(inspect(secrets)).not.toContain(FAKE_SECRETS.LLM_API_KEY);
    expect(String(JSON.stringify({ secrets }))).toContain("LLM_API_KEY");
  });
});

describe("CORS origins and environment (story 3.4)", () => {
  it("allows no browser origin by default, and production by default", () => {
    const { config } = loadConfig({ env: { ...RECORD } });
    expect(config.corsOrigins).toEqual([]);
    expect(config.environment).toBe("production");
  });

  it("refuses a wildcard origin in production, from the environment and from the file", () => {
    const fromEnv = failure(() => loadConfig({ env: { ...RECORD, OCN_NODE_CORS_ORIGINS: "*" } }));
    expect(fromEnv.message).toContain("wildcard CORS origin");
    const readFile = files({ "/c.json": JSON.stringify({ cors: { origins: ["*"] } }) });
    const fromFile = failure(() =>
      loadConfig({ env: { ...RECORD, OCN_NODE_CONFIG: "/c.json" }, readFile }),
    );
    expect(fromFile.message).toContain("wildcard CORS origin");
  });

  it("allows a wildcard origin only in development", () => {
    const { config } = loadConfig({
      env: { ...RECORD, OCN_NODE_ENVIRONMENT: "development", OCN_NODE_CORS_ORIGINS: "*" },
    });
    expect(config.corsOrigins).toEqual(["*"]);
  });

  it("reads exact origins from the environment and the file, comma-separated", () => {
    const { config } = loadConfig({
      env: { ...RECORD, OCN_NODE_CORS_ORIGINS: "https://app.example, http://localhost:8081" },
    });
    expect(config.corsOrigins).toEqual(["https://app.example", "http://localhost:8081"]);
  });

  it("refuses an origin with a path or a bad scheme, without echoing it", () => {
    const error = failure(() =>
      loadConfig({ env: { ...RECORD, OCN_NODE_CORS_ORIGINS: "ftp://secret-host.example/x" } }),
    );
    expect(error.message).toContain("OCN_NODE_CORS_ORIGINS");
    expect(error.message).not.toContain("secret-host");
  });

  it("refuses an unknown environment name", () => {
    expect(
      failure(() => loadConfig({ env: { ...RECORD, OCN_NODE_ENVIRONMENT: "staging" } })).message,
    ).toContain("OCN_NODE_ENVIRONMENT");
  });
});
