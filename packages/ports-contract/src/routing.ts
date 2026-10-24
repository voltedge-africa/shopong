import { expect } from "vite-plus/test";
import type { LatLng, Routing } from "@shopong/ports";
import {
  expectErr,
  expectOk,
  registerContract,
  type ContractCase,
  type ContractOptions,
  type Factory,
} from "./support.js";

export interface RoutingHarness {
  readonly routing: Routing;
  /** Two points inside the tile set, a few kilometres apart by road. */
  readonly origin: LatLng;
  readonly destination: LatLng;
  /** A point outside the tile set. */
  readonly outside: LatLng;
}

/** Decode a precision-6 encoded polyline. */
export function decodePolyline6(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const next = (): number => {
    let result = 0;
    let shift = 1;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result += (byte & 0x1f) * shift;
      shift *= 32;
    } while (byte >= 0x20);
    return result % 2 === 1 ? -(result + 1) / 2 : result / 2;
  };
  while (index < encoded.length) {
    lat += next();
    lng += next();
    points.push({ lat: lat / 1e6, lng: lng / 1e6 });
  }
  return points;
}

function metres(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.sqrt(h));
}

/** Real routers snap points to the nearest road, so allow some slack. */
const SNAP_TOLERANCE_M = 1000;

export const routingContract: readonly ContractCase<RoutingHarness>[] = [
  {
    name: "routes between covered points with distance, time, geometry and tile release",
    run: async ({ routing, origin, destination }) => {
      const route = expectOk(await routing.route({ origin, destination, costing: "auto" }));
      expect(route.costing).toBe("auto");
      expect(route.distanceMeters).toBeGreaterThanOrEqual(metres(origin, destination) * 0.8);
      expect(route.durationSeconds).toBeGreaterThan(0);
      expect(route.tileRelease).not.toBe("");
      const line = decodePolyline6(route.polyline6);
      expect(line.length).toBeGreaterThanOrEqual(2);
      expect(metres(line[0] as LatLng, origin)).toBeLessThan(SNAP_TOLERANCE_M);
      expect(metres(line.at(-1) as LatLng, destination)).toBeLessThan(SNAP_TOLERANCE_M);
    },
  },
  {
    name: "reports the same tile release for repeated requests",
    run: async ({ routing, origin, destination }) => {
      const first = expectOk(await routing.route({ origin, destination, costing: "auto" }));
      const second = expectOk(await routing.route({ origin, destination, costing: "auto" }));
      expect(second.tileRelease).toBe(first.tileRelease);
    },
  },
  {
    name: "walking takes longer than driving",
    run: async ({ routing, origin, destination }) => {
      const drive = expectOk(await routing.route({ origin, destination, costing: "auto" }));
      const walk = expectOk(await routing.route({ origin, destination, costing: "pedestrian" }));
      expect(walk.durationSeconds).toBeGreaterThan(drive.durationSeconds);
    },
  },
  {
    name: "routes a truck with dimensions",
    run: async ({ routing, origin, destination }) => {
      const route = expectOk(
        await routing.route({
          origin,
          destination,
          costing: "truck",
          truck: { heightM: 3.5, weightT: 8, hazmat: false },
        }),
      );
      expect(route.costing).toBe("truck");
    },
  },
  {
    name: "refuses invalid coordinates and truck dimensions",
    run: async ({ routing, origin, destination }) => {
      expectErr(
        await routing.route({ origin: { lat: 91, lng: 0 }, destination, costing: "auto" }),
        "invalid_request",
      );
      expectErr(
        await routing.route({ origin, destination: { lat: 0, lng: Number.NaN }, costing: "auto" }),
        "invalid_request",
      );
      expectErr(
        await routing.route({ origin, destination, costing: "truck", truck: { heightM: -1 } }),
        "invalid_request",
      );
    },
  },
  {
    name: "reports points outside the tile set",
    run: async ({ routing, origin, outside }) => {
      expectErr(
        await routing.route({ origin, destination: outside, costing: "auto" }),
        "out_of_coverage",
        "no_route",
      );
    },
  },
];

/** Register the `Routing` contract against an adapter. */
export function runRoutingContract(
  factory: Factory<RoutingHarness>,
  options?: ContractOptions,
): void {
  registerContract("Routing contract", routingContract, factory, options);
}
