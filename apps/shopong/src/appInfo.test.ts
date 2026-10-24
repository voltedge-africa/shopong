import { describe, expect, it } from "vite-plus/test";

import { appInfo } from "./appInfo";

describe("appInfo", () => {
  it("names the app and spells out OCN correctly", () => {
    expect(appInfo.name).toBe("Shopong");
    expect(appInfo.tagline).toBe("Your access point to the Open Commerce Network (OCN)");
    expect(appInfo.tagline).not.toContain("OCM");
  });

  it("keeps identity creation disabled until it is built", () => {
    expect(appInfo.createIdentity).toEqual({
      label: "Create my identity",
      helper: "Coming soon",
      enabled: false,
    });
  });
});
