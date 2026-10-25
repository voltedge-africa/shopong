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

export type DeliveryMap = { stops: readonly Stop[]; legs: readonly Leg[] };

/** The two themes the app can put the page in; they follow the app's own theme state. */
export type MapMode = "light" | "dark";

/** App to page. */
export type AppMessage = { type: "load"; map: DeliveryMap } | { type: "theme"; mode: MapMode };

/** Page to app. */
export type PageMessage = { type: "ready" } | { type: "error"; message: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isMode = (value: unknown): value is MapMode => value === "light" || value === "dark";

export function parseAppMessage(raw: unknown): AppMessage | undefined {
  const value = typeof raw === "string" ? safeParse(raw) : raw;
  if (!isRecord(value)) return undefined;
  if (value.type === "theme")
    return isMode(value.mode) ? { type: "theme", mode: value.mode } : undefined;
  if (value.type !== "load" || !isRecord(value.map)) return undefined;
  const { stops, legs } = value.map;
  return Array.isArray(stops) && Array.isArray(legs)
    ? { type: "load", map: { stops: stops as Stop[], legs: legs as Leg[] } }
    : undefined;
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
