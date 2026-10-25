import { describe, expect, it } from "vite-plus/test";

import { miniApps, type MiniApp } from "../components/miniapps";
import { appDetails } from "./appDetails";
import { designBuild } from "./builder";
import { artifactOf } from "./ci";
import { appRecord, defaultForm } from "./publish";

const find = (id: string) => miniApps.find((app) => app.id === id)!;
const row = (id: string, label: string) =>
  appDetails(find(id)).rows.find((item) => item.label === label)?.value;

describe("appDetails for the apps the app ships", () => {
  it("has a description for every app", () => {
    for (const app of miniApps) expect(appDetails(app).description.length).toBeGreaterThan(20);
  });

  it("says who made it, and its category", () => {
    expect(row("wallet", "Made by")).toBe("Shopong");
    expect(row("shop", "Made by")).toBe("Third party");
    expect(row("delivery", "Category")).toBe("Logistics");
  });

  it("says an app that runs on its own cannot reach the internet or other apps", () => {
    expect(row("shop", "Runs")).toMatch(/cannot reach the internet/);
    expect(row("delivery", "Runs")).toMatch(/cannot reach the internet/);
    expect(row("chat", "Runs")).toBe("Inside Shopong");
  });

  it("lists nothing it may do and nothing new", () => {
    const details = appDetails(find("wallet"));
    expect(details.mayDo).toEqual([]);
    expect(details.whatsNew).toBeUndefined();
  });
});

describe("appDetails for an app people published", () => {
  const build = designBuild("I need a way to track who owes me and have a way of reminding them");
  const make = (notes: string) => {
    const published = appRecord({
      id: "build-c1",
      build,
      artifact: artifactOf(build),
      form: { ...defaultForm(build), notes },
      now: 0,
    });
    // The same fields `toMiniApp` sets, without loading the screens that draw it.
    const app: MiniApp = {
      ...find("wallet"),
      id: published.id,
      title: published.name,
      description: published.description,
      publisher: published.publisher,
      published,
    };
    return { published, details: appDetails(app) };
  };

  it("uses what the publisher wrote", () => {
    const { published, details } = make("");
    expect(details.description).toBe(published.description);
    expect(details.rows.find((item) => item.label === "Made by")?.value).toBe("You");
    expect(details.rows.find((item) => item.label === "Version")?.value).toBe(published.version);
  });

  it("lists what it may do in capital letters, ending with whether it moves money", () => {
    const { published, details } = make("");
    expect(details.mayDo.length).toBe(published.permissions.length + 1);
    for (const line of details.mayDo) expect(line).toMatch(/^[A-Z]/);
    expect(details.mayDo.at(-1)).toMatch(/money/);
  });

  it("shows the pictures the publisher added, else the app's own screens", () => {
    const withPictures = appRecord({
      id: "build-c1",
      build,
      artifact: artifactOf(build),
      form: { ...defaultForm(build), screenshots: ["a.jpg"] },
      now: 0,
    });
    const app = (published: typeof withPictures): MiniApp => ({
      ...find("wallet"),
      id: published.id,
      publisher: published.publisher,
      published,
    });
    expect(appDetails(app(withPictures)).shots).toEqual([{ kind: "image", uri: "a.jpg" }]);
    const shots = make("").details.shots;
    expect(shots).toHaveLength(build.screens.length);
    expect(shots.every((shot) => shot.kind === "screen")).toBe(true);
  });

  it("has no screenshots for the apps the app ships", () => {
    for (const app of miniApps) expect(appDetails(app).shots).toEqual([]);
  });

  it("shows what is new only when the publisher said", () => {
    expect(make("").details.whatsNew).toBeUndefined();
    expect(make("Reminders on Fridays").details.whatsNew).toBe("Reminders on Fridays");
  });
});
