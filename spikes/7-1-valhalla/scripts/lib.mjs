// Shared helpers for the spike scripts. Everything resolves paths from this file, never from cwd.
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const SPIKE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO = path.resolve(SPIKE, '..', '..');
export const CACHE = path.join(REPO, '.cache');
export const DATASETS = path.join(CACHE, 'valhalla', 'datasets');
export const RESULTS = path.join(SPIKE, 'results');

// Real places in Eswatini (WGS84). Verified inside the extract by the route runs themselves.
export const PLACES = {
  mbabane: { lat: -26.3054, lon: 31.1367 },
  manzini: { lat: -26.4833, lon: 31.3667 },
  matsapha: { lat: -26.5167, lon: 31.3000 }, // industrial estate, between Manzini and the airport
  // a short urban hop inside Mbabane: town centre -> Mbabane Government Hospital area
  mbabaneCentre: { lat: -26.3190, lon: 31.1340 },
  mbabaneNorth: { lat: -26.3120, lon: 31.1450 },
};

export const PAIRS = [
  { name: 'Mbabane -> Manzini', a: PLACES.mbabane, b: PLACES.manzini },
  { name: 'Manzini -> Matsapha', a: PLACES.manzini, b: PLACES.matsapha },
  { name: 'Mbabane short urban hop', a: PLACES.mbabaneCentre, b: PLACES.mbabaneNorth },
];

export const TRUCK = { truck: { height: 4.2, width: 2.5, length: 12, weight: 18, axle_load: 8, hazmat: false } };

export function decodePolyline6(str) {
  const pts = [];
  let i = 0, lat = 0, lon = 0;
  while (i < str.length) {
    for (const axis of [0, 1]) {
      let shift = 0, result = 0, b;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += d; else lon += d;
    }
    pts.push([lat / 1e6, lon / 1e6]);
  }
  return pts;
}

export function haversineKm(p, q) {
  const R = 6371.0088, rad = Math.PI / 180;
  const dLat = (q[0] - p[0]) * rad, dLon = (q[1] - p[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p[0] * rad) * Math.cos(q[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function polylineLengthKm(points) {
  let s = 0;
  for (let i = 1; i < points.length; i++) s += haversineKm(points[i - 1], points[i]);
  return s;
}

/** Decode every leg of a native route and compare its geometric length with the reported summary length. */
export function shapeCheck(native) {
  const pts = native.trip.legs.flatMap((l) => decodePolyline6(l.shape));
  const geomKm = polylineLengthKm(pts);
  const reportedKm = native.trip.summary.length;
  return {
    points: pts.length,
    geomKm: +geomKm.toFixed(3),
    reportedKm,
    ratio: +(geomKm / reportedKm).toFixed(4),
    start: pts[0],
    end: pts[pts.length - 1],
  };
}

export const ms = (n) => +n.toFixed(1);
export const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
