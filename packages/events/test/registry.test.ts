import { describe, expect, it } from "vite-plus/test";
import { createEvent, parseEvent } from "../src/index.js";

describe("role.granted payload", () => {
  const base = {
    space: "ab".repeat(32),
    actor: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
    proof: ["abcd"],
    claimedAt: 1793001600000,
    nonce: "00".repeat(16),
  };
  const grantee = "did:key:z6MkmtmqQWNzwamfa7QWkNU3Sk2qHpuXK4VrfMXXqVouVZtL";

  it("accepts the strict shape", () => {
    expect(
      createEvent({
        ...base,
        type: "role.granted",
        payload: { role: "co-treasurer", grantee, expiresAt: 5 },
      }).type,
    ).toBe("role.granted");
  });

  it.each([
    ["without a role", { grantee, expiresAt: 5 }],
    ["with an empty role", { role: "", grantee, expiresAt: 5 }],
    ["with a number as role", { role: 7, grantee, expiresAt: 5 }],
    ["without a grantee", { role: "driver", expiresAt: 5 }],
    ["with a grantee that is not a did:key", { role: "driver", grantee: "bob", expiresAt: 5 }],
    ["without an end", { role: "driver", grantee }],
    ["with a fractional end", { role: "driver", grantee, expiresAt: 1.5 }],
    ["with a negative end", { role: "driver", grantee, expiresAt: -1 }],
  ] as const)("rejects a role.granted %s", (_name, payload) => {
    expect(parseEvent({ v: 1, ...base, type: "role.granted", payload }).ok).toBe(false);
  });
});

describe("member.removed payload", () => {
  const base = {
    space: "ab".repeat(32),
    actor: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
    proof: [],
    claimedAt: 1793001600000,
    nonce: "00".repeat(16),
  };
  const member = "did:key:z6MkmtmqQWNzwamfa7QWkNU3Sk2qHpuXK4VrfMXXqVouVZtL";

  it("accepts the member, with or without a reason", () => {
    expect(createEvent({ ...base, type: "member.removed", payload: { member } }).type).toBe(
      "member.removed",
    );
    expect(
      createEvent({ ...base, type: "member.removed", payload: { member, reason: "left" } }).type,
    ).toBe("member.removed");
  });

  it.each([
    ["without a member", {}],
    ["with a member that is not a did:key", { member: "bob" }],
    ["with a number as member", { member: 7 }],
    ["with a reason that is not text", { member, reason: 3 }],
  ] as const)("rejects a member.removed %s", (_name, payload) => {
    expect(parseEvent({ v: 1, ...base, type: "member.removed", payload }).ok).toBe(false);
  });
});
