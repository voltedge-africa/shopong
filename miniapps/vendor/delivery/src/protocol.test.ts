import { describe, expect, it } from "vite-plus/test";

import { isFromParent, parseAppMessage } from "./protocol";

describe("the route in a load message (story 7.4)", () => {
  const stops = [
    { id: "a", name: "Depot", lat: -26.2, lng: 28.0, kind: "collection", status: "delivered" },
  ];

  it("accepts a route with its line and three sentences", () => {
    const message = parseAppMessage({
      type: "load",
      map: {
        stops,
        legs: [],
        route: { polyline6: "_p~iF~ps|U", sentences: ["Route from A to B.", "About 1 km.", "x"] },
      },
    });
    expect(message?.type === "load" && message.map.route?.sentences).toHaveLength(3);
  });

  it("refuses a route whose sentences are not text", () => {
    const message = parseAppMessage({
      type: "load",
      map: { stops, legs: [], route: { polyline6: "_p~iF~ps|U", sentences: [1, 2] } },
    });
    expect(message).toBeUndefined();
  });

  it("refuses a route without a line", () => {
    const message = parseAppMessage({
      type: "load",
      map: { stops, legs: [], route: { sentences: ["a"] } },
    });
    expect(message).toBeUndefined();
  });
});

describe("the page listens to its parent only (patch)", () => {
  it("accepts a message from the parent frame, or from the host with no source", () => {
    const parent = { name: "parent" };
    expect(isFromParent(parent, parent)).toBe(true);
    expect(isFromParent(null, parent)).toBe(true);
  });

  it("ignores a message from any other frame", () => {
    expect(isFromParent({ name: "other" }, { name: "parent" })).toBe(false);
  });

  it("refuses a route whose line is truncated", () => {
    const message = parseAppMessage({
      type: "load",
      map: { stops: [], legs: [], route: { polyline6: "_p~iF~ps|", sentences: ["a"] } },
    });
    expect(message).toBeUndefined();
  });
});
