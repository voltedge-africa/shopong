import { describe, expect, it } from "vite-plus/test";

import { deliveryMap, deliveryMessages } from "./data";

describe("deliveryMap", () => {
  it("has unique stop ids", () => {
    const ids = deliveryMap.stops.map((stop) => stop.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only joins stops that exist", () => {
    const ids = new Set(deliveryMap.stops.map((stop) => stop.id));
    for (const leg of deliveryMap.legs) {
      expect(ids.has(leg.from)).toBe(true);
      expect(ids.has(leg.to)).toBe(true);
    }
  });

  it("keeps every stop inside the area the map has data for (Clermont)", () => {
    // The box scripts/fetch-osm.mjs downloads: west, south, east, north.
    const [west, south, east, north] = [30.889, -29.808, 30.921, -29.778];
    for (const { lat, lng } of deliveryMap.stops) {
      expect(lng).toBeGreaterThan(west);
      expect(lng).toBeLessThan(east);
      expect(lat).toBeGreaterThan(south);
      expect(lat).toBeLessThan(north);
    }
  });
});

describe("deliveryMessages", () => {
  it("sends the map in a single load message", () => {
    expect(deliveryMessages).toEqual([{ type: "load", map: deliveryMap }]);
  });
});
