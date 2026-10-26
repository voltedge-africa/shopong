import { haversineMeters } from "./geometry.js";
import {
  err,
  ok,
  type Costing,
  type LatLng,
  type PortError,
  type Result,
  type Route,
  type RouteErrorCode,
  type RouteRequest,
  type Routing,
} from "@shopong/ports";

/** Rough bounding box of South Africa, the default coverage. */
export const SOUTH_AFRICA_BOUNDS = { minLat: -35, maxLat: -22, minLng: 16, maxLng: 33 } as const;

/** Metres per second by costing. */
const SPEED: Record<Costing, number> = { auto: 13.9, truck: 11.1, bicycle: 4.2, pedestrian: 1.4 };

/** Road distance is longer than the straight line; this is the assumed ratio. */
const DETOUR = 1.3;

export interface MemoryRoutingOptions {
  bounds?: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  tileRelease?: string;
}

/** In-memory `Routing`: a straight line, scaled by a detour factor and costing speed. */
export class MemoryRouting implements Routing {
  readonly #bounds: NonNullable<MemoryRoutingOptions["bounds"]>;
  readonly #tileRelease: string;

  constructor(options: MemoryRoutingOptions = {}) {
    this.#bounds = options.bounds ?? SOUTH_AFRICA_BOUNDS;
    this.#tileRelease = options.tileRelease ?? "memory-tiles-2026.01";
  }

  async route(request: RouteRequest): Promise<Result<Route, PortError<RouteErrorCode>>> {
    if (!validPoint(request.origin) || !validPoint(request.destination)) {
      return err("invalid_request", "points must be WGS84 degrees");
    }
    if (!(request.costing in SPEED))
      return err("invalid_request", `unknown costing ${String(request.costing)}`);
    const truck = request.truck ?? {};
    for (const [name, value] of Object.entries(truck)) {
      if (name !== "hazmat" && !(typeof value === "number" && value > 0)) {
        return err("invalid_request", `truck ${name} must be positive`);
      }
    }
    if (!this.#covers(request.origin) || !this.#covers(request.destination)) {
      return err("out_of_coverage", "a point is outside the tile set");
    }
    const distanceMeters = Math.round(
      haversineMeters(request.origin, request.destination) * DETOUR,
    );
    return ok({
      costing: request.costing,
      distanceMeters,
      durationSeconds: Math.max(1, Math.ceil(distanceMeters / SPEED[request.costing])),
      polyline6: encodePolyline6([request.origin, request.destination]),
      tileRelease: this.#tileRelease,
    });
  }

  #covers(point: LatLng): boolean {
    const b = this.#bounds;
    return (
      point.lat >= b.minLat &&
      point.lat <= b.maxLat &&
      point.lng >= b.minLng &&
      point.lng <= b.maxLng
    );
  }
}

function validPoint(point: LatLng): boolean {
  return (
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    Math.abs(point.lat) <= 90 &&
    Math.abs(point.lng) <= 180
  );
}

/** Google encoded-polyline algorithm at precision 6, as Valhalla returns. */
export function encodePolyline6(points: readonly LatLng[]): string {
  let output = "";
  let lastLat = 0;
  let lastLng = 0;
  for (const point of points) {
    const lat = Math.round(point.lat * 1e6);
    const lng = Math.round(point.lng * 1e6);
    output += encodeSigned(lat - lastLat) + encodeSigned(lng - lastLng);
    lastLat = lat;
    lastLng = lng;
  }
  return output;
}

function encodeSigned(value: number): string {
  let rest = value < 0 ? ~(value * 2) : value * 2;
  let output = "";
  while (rest >= 0x20) {
    output += String.fromCharCode((0x20 | (rest & 0x1f)) + 63);
    rest = Math.floor(rest / 32);
  }
  return output + String.fromCharCode(rest + 63);
}
