import type { PortError, Result } from "./common.js";

/** WGS84 degrees. */
export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

export type Costing = "auto" | "truck" | "bicycle" | "pedestrian";

/** Truck dimensions for `truck` costing (Valhalla costing options). */
export interface TruckOptions {
  readonly heightM?: number;
  readonly widthM?: number;
  readonly lengthM?: number;
  readonly weightT?: number;
  readonly axleLoadT?: number;
  readonly hazmat?: boolean;
}

export interface RouteRequest {
  readonly origin: LatLng;
  readonly destination: LatLng;
  readonly costing: Costing;
  readonly truck?: TruckOptions;
}

export interface Route {
  readonly costing: Costing;
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  /** Encoded polyline with 6 decimal places, origin first. */
  readonly polyline6: string;
  /**
   * Release id of the tile manifest the route was computed on. Stored with the route so
   * it is reproducible (architecture 4.4).
   */
  readonly tileRelease: string;
}

export type RouteErrorCode =
  | "invalid_request"
  /** A point lies outside the loaded tile set. */
  | "out_of_coverage"
  /** Both points are covered but no route connects them with this costing. */
  | "no_route";

/**
 * Single-route planning (Valhalla, in the web console or on the OCN Node; never bundled in
 * the mobile app, AGENTS.md rule 7). Owning epic: 7.
 */
export interface Routing {
  route(request: RouteRequest): Promise<Result<Route, PortError<RouteErrorCode>>>;
}
