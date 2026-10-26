import { describe, expect, it } from "vite-plus/test";
import { parseEvent } from "../src/index.js";

// Story 8.1: the event that gives a community its name and rules note. Plain text, length-limited, one line.
const base = {
  v: 1,
  space: "ab".repeat(32),
  actor: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
  proof: [],
  claimedAt: 1793001600000,
  nonce: "00".repeat(16),
};

describe("community.named payload", () => {
  const good = { name: "Ntombi Stokvel", rules: "We pay in on the first Friday." };

  it("accepts the strict shape", () => {
    expect(parseEvent({ ...base, type: "community.named", payload: good }).ok).toBe(true);
  });

  it("accepts empty rules: a community may have no rules note yet", () => {
    expect(
      parseEvent({ ...base, type: "community.named", payload: { ...good, rules: "" } }).ok,
    ).toBe(true);
  });

  it.each([
    ["without a name", { rules: good.rules }],
    ["with an empty name", { ...good, name: "" }],
    ["with a name of only spaces", { ...good, name: "   " }],
    ["with a name longer than 80 characters", { ...good, name: "N".repeat(81) }],
    ["with a name that has a line break", { ...good, name: "Ntombi\nStokvel" }],
    ["with a name that reads as an address", { ...good, name: "12 Church Street" }],
    ["with a name as a number", { ...good, name: 7 }],
    ["without rules", { name: good.name }],
    ["with rules longer than 500 characters", { ...good, rules: "r".repeat(501) }],
    ["with rules as a number", { ...good, rules: 5 }],
    ["with a field the type does not have", { ...good, approvals: 2 }],
    ["with a coordinate", { ...good, lat: -26.2 }],
  ] as const)("rejects a community.named %s", (_name, payload) => {
    expect(
      parseEvent({ ...base, type: "community.named", payload: stripUndefined(payload) }).ok,
    ).toBe(false);
  });
});

function stripUndefined(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}
