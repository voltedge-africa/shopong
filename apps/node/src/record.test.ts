import { describe, expect, it } from "vite-plus/test";
import { ConfigError, ResolvedSecrets } from "./secrets.ts";
import { masterKeyOf, nodeDid, RECORD_MASTER_KEY } from "./record.ts";
import { FAKE_SECRETS } from "./testing/capture.ts";

describe("the record's master key", () => {
  it("decodes 64 hex characters to 32 bytes", () => {
    const key = masterKeyOf(
      new ResolvedSecrets(new Map([[RECORD_MASTER_KEY, FAKE_SECRETS.RECORD_MASTER_KEY]])),
    );
    expect(key.byteLength).toBe(32);
  });

  it("refuses an all-zero key, a key of one repeated digit, and the .env.example placeholder", () => {
    const refused = (value: string) => {
      let caught: unknown;
      try {
        masterKeyOf(new ResolvedSecrets(new Map([[RECORD_MASTER_KEY, value]])));
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ConfigError);
      expect((caught as ConfigError).keys).toEqual([RECORD_MASTER_KEY]);
      expect((caught as ConfigError).message).toContain(RECORD_MASTER_KEY);
      expect((caught as ConfigError).message).not.toContain(value);
    };
    refused("0".repeat(64));
    refused("a".repeat(64));
    refused("F".repeat(64));
    refused("replace-with-64-hex-characters");
  });

  it("refuses a malformed key by name, never by value", () => {
    const secrets = new ResolvedSecrets(new Map([[RECORD_MASTER_KEY, "not-hex-secret-value"]]));
    let caught: unknown;
    try {
      masterKeyOf(secrets);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).message).toContain(RECORD_MASTER_KEY);
    expect((caught as ConfigError).message).not.toContain("not-hex-secret-value");
  });

  it("derives a stable placeholder DID for the Node from the master key", () => {
    const key = Buffer.from(FAKE_SECRETS.RECORD_MASTER_KEY, "hex");
    expect(nodeDid(key)).toBe(nodeDid(key));
    expect(nodeDid(key)).toMatch(/^did:ocn:node-[0-9a-f]{32}$/);
    expect(nodeDid(Buffer.alloc(32, 1))).not.toBe(nodeDid(key));
  });
});
