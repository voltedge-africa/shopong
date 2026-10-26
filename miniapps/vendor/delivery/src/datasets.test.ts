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

describe("toKeplerDatasets with a planned route", () => {
  const encoded = (() => {
    // Three points, precision 6, encoded by the reference algorithm (see polyline.test.ts).
    const points = [
      { lat: -25.7079, lng: 28.4004 },
      { lat: -25.9, lng: 28.2 },
      { lat: -26.2395, lng: 27.9094 },
    ];
    let out = "";
    let lastLat = 0;
    let lastLng = 0;
    const signed = (value: number) => {
      let rest = value < 0 ? ~(value * 2) : value * 2;
      let s = "";
      while (rest >= 0x20) {
        s += String.fromCharCode((0x20 | (rest & 0x1f)) + 63);
        rest = Math.floor(rest / 32);
      }
      return s + String.fromCharCode(rest + 63);
    };
    for (const p of points) {
      const lat = Math.round(p.lat * 1e6);
      const lng = Math.round(p.lng * 1e6);
      out += signed(lat - lastLat) + signed(lng - lastLng);
      lastLat = lat;
      lastLng = lng;
    }
    return out;
  })();

  it("adds a planned-route dataset: one row per piece of the line", () => {
    const datasets = toKeplerDatasets({
      ...map,
      route: { polyline6: encoded, sentences: ["a", "b", "c"] },
    });
    expect(datasets.map((d) => d.info.id)).toEqual(["stops", "route", "planned-route"]);
    const line = datasets[2]!;
    expect(line.data.rows).toHaveLength(2);
    expect(line.data.rows[0]![2]).toBeCloseTo(-25.7079, 6);
  });

  it("adds no planned-route dataset when there is no route", () => {
    expect(toKeplerDatasets(map).map((d) => d.info.id)).toEqual(["stops", "route"]);
  });
});

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

  it("parses a theme message from a JSON string or an object", () => {
    expect(parseAppMessage('{"type":"theme","mode":"light"}')).toEqual({
      type: "theme",
      mode: "light",
    });
    expect(parseAppMessage({ type: "theme", mode: "dark" })).toEqual({
      type: "theme",
      mode: "dark",
    });
  });

  it("ignores a theme message with a mode it does not know", () => {
    expect(parseAppMessage({ type: "theme", mode: "sepia" })).toBeUndefined();
    expect(parseAppMessage({ type: "theme" })).toBeUndefined();
  });

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
