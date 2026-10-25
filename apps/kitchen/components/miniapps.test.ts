import { describe, expect, it } from "vite-plus/test";

import { CATEGORIES, contentOf, filterMiniApps, installedMiniApps, miniApps } from "./miniapps";

describe("miniApps", () => {
  it("has unique ids that are safe to put in a route", () => {
    const ids = miniApps.map((app) => app.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it("puts every app in a known category and every category has an app", () => {
    for (const app of miniApps) expect(CATEGORIES).toContain(app.category);
    for (const category of CATEGORIES) {
      expect(miniApps.some((app) => app.category === category)).toBe(true);
    }
  });

  it("installs the original eight by default and leaves some for Discover", () => {
    expect(installedMiniApps.map((app) => app.id)).toEqual([
      "shop",
      "stokvel",
      "wallet",
      "delivery",
      "orders",
      "suppliers",
      "chat",
      "insights",
    ]);
    expect(miniApps.length).toBeGreaterThan(installedMiniApps.length);
  });

  it("gives an app without content a placeholder page that names it", () => {
    const stokvel = miniApps.find((app) => app.id === "stokvel")!;
    const content = contentOf(stokvel);
    expect(content.kind).toBe("web");
    expect(content.kind === "web" && content.source.html).toContain("Stokvel");
  });

  it("serves web, native and bundle content as declared", () => {
    const kind = (id: string) => contentOf(miniApps.find((app) => app.id === id)!).kind;
    expect(kind("shop")).toBe("web");
    expect(kind("insights")).toBe("native");
    expect(kind("chat")).toBe("native");
    expect(kind("delivery")).toBe("bundle");
  });
});

describe("filterMiniApps", () => {
  const titles = (apps: readonly { title: string }[]) => apps.map((app) => app.title);

  it("returns every app for no filter", () => {
    expect(filterMiniApps(miniApps)).toEqual(miniApps);
    expect(filterMiniApps(miniApps, { query: "   " })).toEqual(miniApps);
  });

  it("matches the title ignoring case and surrounding spaces", () => {
    expect(titles(filterMiniApps(miniApps, { query: "  WALL " }))).toEqual(["Wallet"]);
    expect(
      titles(filterMiniApps(miniApps, { query: "s" })).every((title) => /s/i.test(title)),
    ).toBe(true);
  });

  it("filters by category", () => {
    const money = filterMiniApps(miniApps, { category: "Money" });
    expect(titles(money)).toEqual(["Wallet", "Funding", "Savings"]);
  });

  it("combines the query and the category", () => {
    // "n" is in Funding and Savings but not in Wallet, and in apps of other categories too.
    expect(titles(filterMiniApps(miniApps, { query: "n", category: "Money" }))).toEqual([
      "Funding",
      "Savings",
    ]);
    expect(filterMiniApps(miniApps, { query: "chat", category: "Money" })).toEqual([]);
  });

  it("returns nothing when nothing matches", () => {
    expect(filterMiniApps(miniApps, { query: "zzzz" })).toEqual([]);
  });

  it("works on the installed list too", () => {
    expect(titles(filterMiniApps(installedMiniApps, { category: "Commerce" }))).toEqual([
      "Shop",
      "Orders",
      "Suppliers",
    ]);
  });
});
