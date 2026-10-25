import { describe, expect, it } from "vite-plus/test";

import { createInstallStore, withInstallChoices } from "./installedApps";

const apps = [
  { id: "shop", installed: true },
  { id: "insights", installed: false },
];

describe("install store", () => {
  it("starts with no choices, so every app is as shipped", () => {
    const store = createInstallStore();
    expect(withInstallChoices(apps, store.get())).toEqual(apps);
  });

  it("uninstalls an installed app and installs one that is not", () => {
    const store = createInstallStore();
    store.uninstall("shop");
    store.install("insights");
    expect(withInstallChoices(apps, store.get())).toEqual([
      { id: "shop", installed: false },
      { id: "insights", installed: true },
    ]);
  });

  it("puts an app back by installing it again", () => {
    const store = createInstallStore();
    store.uninstall("shop");
    store.install("shop");
    expect(withInstallChoices(apps, store.get())).toEqual(apps);
  });

  it("applies to apps it has never seen, such as ones published later", () => {
    const store = createInstallStore();
    store.uninstall("build-c1");
    const result = withInstallChoices([{ id: "build-c1", installed: true }], store.get());
    expect(result).toEqual([{ id: "build-c1", installed: false }]);
  });

  it("tells listeners on every change, and stops once they unsubscribe", () => {
    const store = createInstallStore();
    let calls = 0;
    const unsubscribe = store.subscribe(() => (calls += 1));
    store.uninstall("shop");
    store.install("shop");
    unsubscribe();
    store.uninstall("shop");
    expect(calls).toBe(2);
  });

  it("hands out a new map on each change, so a screen can tell it changed", () => {
    const store = createInstallStore();
    const before = store.get();
    store.uninstall("shop");
    expect(store.get()).not.toBe(before);
    expect(before.size).toBe(0);
  });
});
