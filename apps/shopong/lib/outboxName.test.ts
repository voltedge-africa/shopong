import { describe, expect, it } from "vite-plus/test";
import { outboxNameFor } from "./outboxName";

describe("the outbox file is kept per identity (review P5)", () => {
  const alice = "did:key:z6MkmtmqQWNzwamfa7QWkNU3Sk2qHpuXK4VrfMXXqVouVZtL";
  const bob = "did:key:z6MkhNzDwSUZ8kpBMkBH3Jy4cQmuvfjTVdXkQfH4p5mQhYd1";

  it("gives two identities two different files, and the same identity always the same file", () => {
    expect(outboxNameFor(alice)).not.toBe(outboxNameFor(bob));
    expect(outboxNameFor(alice)).toBe(outboxNameFor(alice));
  });

  it("names a file with a hash, never the DID itself", () => {
    const name = outboxNameFor(alice);
    expect(name).toMatch(/^outbox-[0-9a-f]{32}\.json$/u);
    expect(name).not.toContain("did");
    expect(name).not.toContain(alice.slice(8, 20));
  });
});
