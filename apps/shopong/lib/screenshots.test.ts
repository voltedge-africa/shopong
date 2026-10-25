import { describe, expect, it } from "vite-plus/test";

import { designBuild } from "./builder";
import { MAX_SCREENSHOTS, addImages, removeImage, shotsFor } from "./screenshots";

const { screens } = designBuild("I need a dashboard of my daily sales");

describe("shotsFor", () => {
  it("shows the pictures the author added, and only those", () => {
    expect(shotsFor(["a.jpg", "b.jpg"], screens)).toEqual([
      { kind: "image", uri: "a.jpg" },
      { kind: "image", uri: "b.jpg" },
    ]);
  });

  it("shows the app's own screens when there are no pictures", () => {
    const shots = shotsFor([], screens);
    expect(shots).toHaveLength(screens.length);
    expect(shots.every((shot) => shot.kind === "screen")).toBe(true);
  });

  it("has no row for an app with neither", () => {
    expect(shotsFor()).toEqual([]);
    expect(shotsFor([], [])).toEqual([]);
  });
});

describe("addImages", () => {
  it("puts new pictures last", () => {
    expect(addImages(["a"], ["b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("leaves out pictures that are already there, and repeats in one pick", () => {
    expect(addImages(["a"], ["a", "b", "b"])).toEqual(["a", "b"]);
  });

  it("keeps only as many as an app can show, dropping the newest", () => {
    const many = Array.from({ length: MAX_SCREENSHOTS + 3 }, (_, index) => `p${index}`);
    const result = addImages(["first"], many);
    expect(result).toHaveLength(MAX_SCREENSHOTS);
    expect(result[0]).toBe("first");
  });

  it("does not change what it was given", () => {
    const current = ["a"];
    addImages(current, ["b"]);
    expect(current).toEqual(["a"]);
  });
});

describe("removeImage", () => {
  it("takes out that picture and keeps the order of the rest", () => {
    expect(removeImage(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("does nothing for a picture that is not there", () => {
    expect(removeImage(["a"], "z")).toEqual(["a"]);
  });
});
