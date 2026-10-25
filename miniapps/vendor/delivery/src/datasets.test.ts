import { describe, expect, it } from "vite-plus/test";

import { parseAppMessage, parsePageMessage, type DeliveryMap } from "./protocol";
import { paddedBounds, toKeplerDatasets } from "./datasets";

const map: DeliveryMap = {
  stops: [
    { id: "a", name: "Depot", lat: -26.2, lng: 28.0, kind: "collection", status: "delivered" },
    { id: "b", name: "Mama Joy", lat: -26.25, lng: 27.9, kind: "dropoff", status: "pending" },
  ],
  legs: [{ from: "a", to: "b" }],
};

describe("toKeplerDatasets", () => {
  it("makes a point dataset with one row per stop, in field order", () => {
    const [stops] = toKeplerDatasets(map);
    expect(stops!.info.id).toBe("stops");
    expect(stops!.data.fields.map((f) => f.name)).toEqual(["name", "kind", "status", "lat", "lng"]);
    expect(stops!.data.rows).toEqual([
      ["Depot", "collection", "delivered", -26.2, 28.0],
      ["Mama Joy", "dropoff", "pending", -26.25, 27.9],
    ]);
  });

  it("makes a line dataset whose columns are the coordinates of both ends", () => {
    const route = toKeplerDatasets(map)[1]!;
    expect(route.data.fields.map((f) => f.name)).toEqual([
      "from",
      "to",
      "lat0",
      "lng0",
      "lat1",
      "lng1",
    ]);
    expect(route.data.rows).toEqual([["Depot", "Mama Joy", -26.2, 28.0, -26.25, 27.9]]);
  });

  it("skips a leg that refers to a stop that does not exist", () => {
    const route = toKeplerDatasets({ ...map, legs: [{ from: "a", to: "zzz" }] })[1]!;
    expect(route.data.rows).toEqual([]);
  });
});

describe("paddedBounds", () => {
  it("grows the bounding box of the stops by the ratio on every side", () => {
    const [lngMin, latMin, lngMax, latMax] = paddedBounds(map.stops, 0.5);
    expect(lngMin).toBeCloseTo(27.9 - 0.05);
    expect(lngMax).toBeCloseTo(28.0 + 0.05);
    expect(latMin).toBeCloseTo(-26.25 - 0.025);
    expect(latMax).toBeCloseTo(-26.2 + 0.025);
  });

  it("still gives a single stop an area to show", () => {
    const [lngMin, latMin, lngMax, latMax] = paddedBounds([map.stops[0]!]);
    expect(lngMax).toBeGreaterThan(lngMin);
    expect(latMax).toBeGreaterThan(latMin);
  });
});

describe("messages", () => {
  it("parses a load message from a JSON string or an object", () => {
    const message = { type: "load", map };
    expect(parseAppMessage(JSON.stringify(message))).toEqual(message);
    expect(parseAppMessage(message)).toEqual(message);
  });

  it.each([undefined, null, 5, "not json", "{}", { type: "load" }, { type: "load", map: {} }])(
    "ignores %j as an app message",
    (raw) => {
      expect(parseAppMessage(raw)).toBeUndefined();
    },
  );

  it("parses the page's ready and error messages and ignores others", () => {
    expect(parsePageMessage('{"type":"ready"}')).toEqual({ type: "ready" });
    expect(parsePageMessage({ type: "error", message: "boom" })).toEqual({
      type: "error",
      message: "boom",
    });
    expect(parsePageMessage({ type: "error" })).toBeUndefined();
    expect(parsePageMessage("nope")).toBeUndefined();
  });
});
