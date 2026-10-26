// The page decodes the route line the Node sends as a precision-6 encoded polyline (story 7.4). The encoder here is the
// reference algorithm, so the round trip checks the decoder against it.
import { describe, expect, it } from "vite-plus/test";

import { decodePolyline6 } from "./polyline";

/** The reference encoder (Google's algorithm at precision 6), as the Node's routing adapter writes it. */
function encode6(points: readonly { lat: number; lng: number }[]): string {
  const signed = (value: number) => {
    let rest = value < 0 ? ~(value * 2) : value * 2;
    let out = "";
    while (rest >= 0x20) {
      out += String.fromCharCode((0x20 | (rest & 0x1f)) + 63);
      rest = Math.floor(rest / 32);
    }
    return out + String.fromCharCode(rest + 63);
  };
  let out = "";
  let lastLat = 0;
  let lastLng = 0;
  for (const p of points) {
    const lat = Math.round(p.lat * 1e6);
    const lng = Math.round(p.lng * 1e6);
    out += signed(lat - lastLat) + signed(lng - lastLng);
    lastLat = lat;
    lastLng = lng;
  }
  return out;
}

describe("decodePolyline6", () => {
  it("gives back the points that were encoded, in order, to six decimal places", () => {
    const points = [
      { lat: -25.7079, lng: 28.4004 },
      { lat: -25.9, lng: 28.2 },
      { lat: -26.2395, lng: 27.9094 },
    ];
    const decoded = decodePolyline6(encode6(points));
    expect(decoded).toHaveLength(3);
    decoded?.forEach((p, i) => {
      expect(p.lat).toBeCloseTo(points[i]!.lat, 6);
      expect(p.lng).toBeCloseTo(points[i]!.lng, 6);
    });
  });

  it("reads nothing as no points", () => {
    expect(decodePolyline6("")).toEqual([]);
  });
});

describe("decodePolyline6 refuses what is not a line (patch)", () => {
  it("returns nothing for a truncated line, rather than NaN bounds", () => {
    const full = encode6([
      { lat: -25.7079, lng: 28.4004 },
      { lat: -26.2395, lng: 27.9094 },
    ]);
    expect(decodePolyline6(full.slice(0, full.length - 1))).toBeUndefined();
    expect(decodePolyline6(full.slice(0, 3))).toBeUndefined();
  });

  it("returns nothing for characters outside the encoding", () => {
    expect(decodePolyline6("\u0001\u0002")).toBeUndefined();
  });
});
