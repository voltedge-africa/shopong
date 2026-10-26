/**
 * What the Delivery mini app and the Kepler page say to each other. Plain data, no React, so the
 * app can import it too. The page never reaches out: the app sends it the data to show.
 */

export type Stop = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  kind: "collection" | "dropoff";
  status: "pending" | "delivered";
};

export type Leg = { from: string; to: string };

/**
 * The planned route the Node sent (story 7.4): the line as a precision-6 encoded polyline, and the three plain
 * sentences the card shows. The page decodes the line itself; the phone never does.
 */
import { decodePolyline6 } from "./polyline";

export type RoutePlan = { polyline6: string; sentences: readonly string[] };

export type DeliveryMap = { stops: readonly Stop[]; legs: readonly Leg[]; route?: RoutePlan };

/** The two themes the app can put the page in; they follow the app's own theme state. */
export type MapMode = "light" | "dark";

/** App to page. */
export type AppMessage = { type: "load"; map: DeliveryMap } | { type: "theme"; mode: MapMode };

/** Page to app. */
export type PageMessage = { type: "ready" } | { type: "error"; message: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isMode = (value: unknown): value is MapMode => value === "light" || value === "dark";

/**
 * Whether a message came from the frame that hosts the page (its parent), or from the host app, which posts with no
 * source. Any other frame is ignored (patch of story 7.4).
 */
export function isFromParent(source: unknown, parent: unknown): boolean {
  return source === null || source === undefined || source === parent;
}

const isRoute = (value: unknown): value is RoutePlan =>
  isRecord(value) &&
  typeof value.polyline6 === "string" &&
  decodePolyline6(value.polyline6) !== undefined &&
  Array.isArray(value.sentences) &&
  value.sentences.every((sentence) => typeof sentence === "string");

export function parseAppMessage(raw: unknown): AppMessage | undefined {
  const value = typeof raw === "string" ? safeParse(raw) : raw;
  if (!isRecord(value)) return undefined;
  if (value.type === "theme")
    return isMode(value.mode) ? { type: "theme", mode: value.mode } : undefined;
  if (value.type !== "load" || !isRecord(value.map)) return undefined;
  const { stops, legs, route } = value.map;
  if (!Array.isArray(stops) || !Array.isArray(legs)) return undefined;
  if (route !== undefined && !isRoute(route)) return undefined;
  return {
    type: "load",
    map: {
      stops: stops as Stop[],
      legs: legs as Leg[],
      ...(route === undefined ? {} : { route: route as RoutePlan }),
    },
  };
}

export function parsePageMessage(raw: unknown): PageMessage | undefined {
  const value = typeof raw === "string" ? safeParse(raw) : raw;
  if (!isRecord(value)) return undefined;
  if (value.type === "ready") return { type: "ready" };
  if (value.type === "error" && typeof value.message === "string") {
    return { type: "error", message: value.message };
  }
  return undefined;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
