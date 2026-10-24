// Guards that the golden vectors are the single source of expectations: test
// files may not embed their own digests or canonical strings, and only
// test/vectors.ts may load the vector file.
import { describe, expect, it } from "vite-plus/test";
import canonicalTest from "./canonical.test.ts?raw";
import commitmentTest from "./commitment.test.ts?raw";
import crossTest from "./cross-implementation.test.ts?raw";
import envelopeTest from "./envelope.test.ts?raw";
import reference from "./reference.ts?raw";
import utf8Test from "./utf8.test.ts?raw";
import { vectors } from "./vectors.js";

const sources: Record<string, string> = {
  "canonical.test.ts": canonicalTest,
  "commitment.test.ts": commitmentTest,
  "cross-implementation.test.ts": crossTest,
  "envelope.test.ts": envelopeTest,
  "reference.ts": reference,
  "utf8.test.ts": utf8Test,
};

describe("golden vectors are the single source", () => {
  it("no test file embeds a SHA-512 or HMAC-SHA512 hex digest", () => {
    for (const [file, source] of Object.entries(sources)) {
      expect(source.match(/[0-9a-f]{128}/), file).toBeNull();
    }
  });

  it("no test file embeds an expected canonical string from the vectors", () => {
    const expected = [...vectors.canonical.accept, ...vectors.events.accept]
      .map((v) => v.canonical)
      .filter((c) => c.length > 24);
    for (const [file, source] of Object.entries(sources)) {
      for (const c of expected) expect(source.includes(c), `${file} contains ${c}`).toBe(false);
    }
  });

  it("only test/vectors.ts loads golden.json", () => {
    for (const [file, source] of Object.entries(sources)) {
      expect(source.includes("golden.json"), file).toBe(false);
    }
  });

  it("every vector section the tests iterate is non-empty", () => {
    const sections = [
      vectors.canonical.accept,
      vectors.canonical.reject,
      vectors.events.accept,
      vectors.events.reject,
      vectors.events.decodeReject,
      vectors.phone.accept,
      vectors.phone.reject,
      vectors.commitments,
    ];
    for (const s of sections) expect(s.length).toBeGreaterThan(0);
    expect(vectors.profile).toBe("ocn-jcs-1");
  });
});
