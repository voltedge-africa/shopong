import { describe, expect, it } from "vite-plus/test";

import { designBuild } from "./builder";
import { artifactOf } from "./ci";
import { appRecord, defaultForm, type PublishedApp } from "./publish";
import { createPublishedStore, publishIdFor, publishOffer } from "./publishedApps";

const build = designBuild("I need a way to track who owes me and have a way of reminding them");
const NOW = new Date(2026, 9, 25, 14, 30).getTime();
const app = (version = "1.0", id = publishIdFor("c1")): PublishedApp => ({
  ...appRecord({
    id,
    build,
    artifact: { ...artifactOf(build), version },
    form: defaultForm(build),
    now: NOW,
  }),
});

describe("published apps", () => {
  it("starts empty and adds what is published", () => {
    const store = createPublishedStore();
    expect(store.get()).toEqual([]);
    store.publish(app());
    expect(store.get().map((item) => item.name)).toEqual(["Pledge tracker"]);
  });

  it("replaces an app that is published again, so a new version updates the old one", () => {
    const store = createPublishedStore();
    store.publish(app("1.0"));
    store.publish(app("1.1"));
    expect(store.get()).toHaveLength(1);
    expect(store.get()[0]?.version).toBe("1.1");
  });

  it("keeps different projects apart", () => {
    const store = createPublishedStore();
    store.publish(app());
    store.publish(app("1.0", publishIdFor("c2")));
    expect(store.get().map((item) => item.id)).toEqual(["build-c1", "build-c2"]);
  });

  it("tells subscribers, and stops when they leave", () => {
    const store = createPublishedStore();
    let calls = 0;
    const stop = store.subscribe(() => calls++);
    store.publish(app());
    expect(calls).toBe(1);
    stop();
    store.publish(app("1.1"));
    expect(calls).toBe(1);
  });

  it("does not change the list it handed out", () => {
    const store = createPublishedStore();
    const before = store.get();
    store.publish(app());
    expect(before).toEqual([]);
  });
});

describe("publishOffer", () => {
  it("offers to publish, then to open, and to publish an update when there is a newer version", () => {
    const id = publishIdFor("c1");
    expect(publishOffer([], id, "1.0")).toBe("publish");
    expect(publishOffer([app("1.0")], id, "1.0")).toBe("open");
    expect(publishOffer([app("1.0")], id, "1.1")).toBe("update");
    expect(publishOffer([app("1.0")], publishIdFor("c2"), "1.0")).toBe("publish");
  });
});
