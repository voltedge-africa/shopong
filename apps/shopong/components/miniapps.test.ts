import { describe, expect, it } from "vite-plus/test";

import {
  CATEGORIES,
  filterMiniApps,
  groupMiniApps,
  installedMiniApps,
  miniApps,
  type MiniApp,
} from "./miniapps";

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

  it("installs Shop, Wallet and Chat by default and leaves three vendored apps for Discover", () => {
    expect(installedMiniApps.map((app) => app.id)).toEqual(["shop", "wallet", "chat"]);
    expect(miniApps.filter((app) => !app.installed).map((app) => app.id)).toEqual([
      "insights",
      "delivery",
      "orders",
      "timeline",
    ]);
  });

  it("serves each app's content as its kind: web for third-party, native and bundle for vendored", () => {
    const kind = (id: string) => miniApps.find((app) => app.id === id)?.content.kind;
    expect(kind("shop")).toBe("web");
    expect(kind("wallet")).toBe("native");
    expect(kind("chat")).toBe("native");
    expect(kind("insights")).toBe("native");
    expect(kind("delivery")).toBe("bundle");
    expect(kind("orders")).toBe("native");
    expect(kind("timeline")).toBe("native");
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
    expect(titles(filterMiniApps(miniApps, { query: "e" }))).toEqual([
      "Wallet",
      "Delivery",
      "Orders",
      "Payment timeline",
    ]);
  });

  it("filters by category", () => {
    expect(titles(filterMiniApps(miniApps, { category: "Community" }))).toEqual(["Chat"]);
  });

  it("combines the query and the category", () => {
    expect(titles(filterMiniApps(miniApps, { query: "e", category: "Logistics" }))).toEqual([
      "Delivery",
    ]);
    expect(filterMiniApps(miniApps, { query: "chat", category: "Money" })).toEqual([]);
  });

  it("returns nothing when nothing matches", () => {
    expect(filterMiniApps(miniApps, { query: "zzzz" })).toEqual([]);
  });

  it("works on the installed list too", () => {
    expect(titles(filterMiniApps(installedMiniApps, { category: "Commerce" }))).toEqual(["Shop"]);
  });
});

describe("groupMiniApps", () => {
  const made = (id: string, publisher: string): MiniApp => ({
    ...miniApps[0]!,
    id,
    title: id,
    publisher,
  });

  it("puts Shopong's apps first, then yours, then everyone else's", () => {
    const groups = groupMiniApps([
      made("c", "Mthunzi Spaza Traders"),
      made("b", "You"),
      made("a", "Shopong"),
      made("d", "Third party"),
    ]);
    expect(groups.map((group) => group.title)).toEqual([
      "By Shopong",
      "Your apps",
      "Community apps",
    ]);
    expect(groups.map((group) => group.apps.map((app) => app.id))).toEqual([
      ["a"],
      ["b"],
      ["c", "d"],
    ]);
  });

  it("leaves out a section with no apps", () => {
    expect(groupMiniApps([made("a", "Shopong")]).map((group) => group.title)).toEqual([
      "By Shopong",
    ]);
    expect(groupMiniApps([])).toEqual([]);
  });

  it("shows every app the app ships exactly once", () => {
    const ids = groupMiniApps(miniApps).flatMap((group) => group.apps.map((app) => app.id));
    expect([...ids].sort()).toEqual(miniApps.map((app) => app.id).sort());
  });
});
