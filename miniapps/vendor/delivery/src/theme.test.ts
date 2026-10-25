import { describe, expect, it } from "vite-plus/test";

import { ATTRIBUTION, makeClermontStyle } from "./basemap/style";
import { makeLayerConfig } from "./mapConfig";

const backgroundColor = (mode: "light" | "dark") => {
  const [background] = makeClermontStyle(mode).layers.filter(
    (l) => "id" in l && l.id === "background",
  );
  return (background!.paint as { "background-color": string })["background-color"];
};

describe("makeClermontStyle", () => {
  it("starts from the background each theme dresses the map in", () => {
    expect(backgroundColor("dark")).toBe("#0b0f14");
    expect(backgroundColor("light")).toBe("#f1f1ee");
  });

  it("keeps the OpenStreetMap attribution out of the paint", () => {
    expect(ATTRIBUTION).toContain("OpenStreetMap");
  });

  it("draws the same layer ids whatever the theme is", () => {
    const ids = (mode: "light" | "dark") =>
      makeClermontStyle(mode).layers.map((l) => "id" in l && l.id);
    expect(ids("dark")).toEqual(ids("light"));
  });
});

describe("makeLayerConfig", () => {
  it("inks the stops differently per theme", () => {
    const ink = (mode: "light" | "dark") => {
      const [stopsLayer] = makeLayerConfig(mode).config.visState.layers.filter(
        (l) => "id" in l && l.id === "stops-layer",
      );
      return JSON.parse(
        JSON.stringify({
          text: stopsLayer!.config.textLabel[0]!.color,
          stroke: stopsLayer!.config.visConfig.strokeColor,
        }),
      ) as { text: number[]; stroke: number[] };
    };
    expect(ink("dark")).not.toEqual(ink("light"));
  });
});
