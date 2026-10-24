import { describe, expect, it } from "vite-plus/test";
import { CHECKS, evaluate, parseDotenv, render } from "./check-env.ts";

const full = Object.fromEntries(CHECKS.map((c) => [c.name, `/secret/${c.name}`]));

describe("evaluate", () => {
  it("reports everything missing for an empty environment", () => {
    expect(evaluate({}, () => true).every((r) => r.status === "missing")).toBe(true);
  });

  it("reports everything present when set and files exist", () => {
    expect(evaluate(full, () => true).every((r) => r.status === "present")).toBe(true);
  });

  it("treats blank values as missing and absent key files as file-missing", () => {
    const results = evaluate({ ...full, STITCH_CLIENT_ID: "  " }, () => false);
    const by = Object.fromEntries(results.map((r) => [r.name, r.status]));
    expect(by["STITCH_CLIENT_ID"]).toBe("missing");
    expect(by["SOLANA_DEVNET_KEYPAIR_PATH"]).toBe("file-missing");
    expect(by["LEDFRA_API_TOKEN"]).toBe("present");
  });
});

describe("render", () => {
  it("never contains a credential value", () => {
    const secret = "sk_test_do_not_print_me";
    const out = render(
      evaluate({ ...full, STITCH_CLIENT_SECRET: secret, LEDFRA_API_TOKEN: secret }, () => true),
    );
    expect(out).not.toContain(secret);
    expect(out).not.toContain("/secret/");
  });
});

describe("parseDotenv", () => {
  it("parses assignments, quotes, export and comments", () => {
    expect(parseDotenv(`# c\nA=1\nexport B="two words"\nC='x'\n\nD=\n`)).toEqual({
      A: "1",
      B: "two words",
      C: "x",
      D: "",
    });
  });
});
