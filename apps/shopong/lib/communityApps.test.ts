import { describe, expect, it } from "vite-plus/test";

import { communityApps } from "./communityApps";
import { YOU } from "./publish";
import { publishedStore } from "./publishedApps";

describe("community apps", () => {
  it("are by someone who is neither you nor Shopong", () => {
    expect(communityApps.length).toBeGreaterThan(0);
    for (const app of communityApps) {
      expect(app.publisher).not.toBe(YOU);
      expect(app.publisher).not.toBe("Shopong");
    }
  });

  it("have ids that cannot clash with what you build", () => {
    for (const app of communityApps) expect(app.id).not.toMatch(/^build-/);
  });

  it("are published from the start, so Discover lists them", () => {
    expect(publishedStore.get().map((app) => app.id)).toEqual(communityApps.map((app) => app.id));
  });
});
