import { describe, expect, it } from "vite-plus/test";
import {
  accountType,
  asEventId,
  capabilityCovers,
  isAccountSlug,
  isDid,
  isEventId,
  isMoney,
  money,
  type Capability,
} from "./index.js";

const space = "ocn:space/abc";

describe("capabilityCovers (attenuation rule)", () => {
  const parent: Capability = { with: space, can: "payment/approve", ceiling: money("ZAR", 500_00) };

  it("allows the same capability", () => {
    expect(capabilityCovers(parent, parent)).toBe(true);
  });

  it("allows a narrower resource and a lower ceiling", () => {
    expect(
      capabilityCovers(parent, {
        with: `${space}/orders/1`,
        can: "payment/approve",
        ceiling: money("ZAR", 100_00),
      }),
    ).toBe(true);
  });

  it("rejects a sibling resource that merely shares a prefix", () => {
    expect(capabilityCovers(parent, { ...parent, with: `${space}def` })).toBe(false);
  });

  it("rejects a broader resource", () => {
    expect(capabilityCovers(parent, { ...parent, with: "ocn:space" })).toBe(false);
  });

  it("rejects a higher ceiling, a dropped ceiling and a different currency", () => {
    expect(capabilityCovers(parent, { ...parent, ceiling: money("ZAR", 500_01) })).toBe(false);
    expect(capabilityCovers(parent, { with: space, can: "payment/approve" })).toBe(false);
    expect(capabilityCovers(parent, { ...parent, ceiling: money("USD", 1) })).toBe(false);
  });

  it("rejects a different ability", () => {
    expect(capabilityCovers(parent, { ...parent, can: "order/propose" })).toBe(false);
  });

  it("supports namespace and superuser wildcards", () => {
    expect(
      capabilityCovers({ with: space, can: "order/*" }, { with: space, can: "order/pledge" }),
    ).toBe(true);
    expect(
      capabilityCovers({ with: space, can: "order/*" }, { with: space, can: "member/invite" }),
    ).toBe(false);
    expect(capabilityCovers({ with: space, can: "*" }, { with: space, can: "member/invite" })).toBe(
      true,
    );
    expect(capabilityCovers({ with: space, can: "order/*" }, { with: space, can: "*" })).toBe(
      false,
    );
  });
});

describe("value types", () => {
  it("validates event ids", () => {
    const id = "a".repeat(128);
    expect(isEventId(id)).toBe(true);
    expect(asEventId(id)).toBe(id);
    expect(isEventId("A".repeat(128))).toBe(false);
    expect(isEventId("a".repeat(64))).toBe(false);
    expect(() => asEventId("nope")).toThrow(TypeError);
  });

  it("keeps money in integer minor units", () => {
    expect(money("ZAR", 1050)).toEqual({ currency: "ZAR", minor: 1050 });
    expect(() => money("ZAR", 10.5)).toThrow(TypeError);
    expect(() => money("zar", 1)).toThrow(TypeError);
    expect(isMoney({ currency: "ZAR", minor: Number.MAX_SAFE_INTEGER + 1 })).toBe(false);
  });

  it("validates account slugs and DIDs", () => {
    expect(isAccountSlug("liabilities:member/abc-1")).toBe(true);
    expect(accountType("equity:fees")).toBe("equity");
    expect(isAccountSlug("cash:pool")).toBe(false);
    expect(isAccountSlug("assets:Pool")).toBe(false);
    expect(isDid("did:key:z6Mk")).toBe(true);
    expect(isDid("key:z6Mk")).toBe(false);
  });
});
