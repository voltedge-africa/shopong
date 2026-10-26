// The phone's route card state (story 7.4). The Node plans and writes the sentences; the phone shows them and says
// plainly when it cannot plan or read a route. Nothing here computes a route.
import type { NodeFailure, NodeReply, RouteAnswer } from "./nodeClient";

/** A place the community registered, as the record shows it: its id and its label and area, never a coordinate. */
export interface RoutePlace {
  readonly id: string;
  readonly label: string;
  readonly area: string;
}

/**
 * The message the Delivery page is sent for a planned route: its line and its three sentences. The page fits its view to
 * the line, since the phone holds no stop of the route.
 */
export function routeLoadMessage(route: RouteAnswer): {
  readonly type: "load";
  readonly map: {
    readonly stops: readonly never[];
    readonly legs: readonly never[];
    readonly route: { readonly polyline6: string; readonly sentences: readonly string[] };
  };
} {
  return {
    type: "load",
    map: {
      stops: [],
      legs: [],
      route: { polyline6: route.polyline6, sentences: route.sentences },
    },
  };
}

/** Said when the Node cannot be reached, so a route cannot be planned now. */
export const OFFLINE_PLAN_MESSAGE = "Planning a route needs a connection.";

/** The plain sentence for a route that could not be planned or read. */
export function planFailureMessage(failure: NodeFailure): string {
  return failure.kind === "offline" ? OFFLINE_PLAN_MESSAGE : failure.reason;
}

export type RouteScreen =
  | { readonly state: "none" }
  | { readonly state: "shown"; readonly route: RouteAnswer }
  | { readonly state: "unreachable"; readonly message: string }
  | { readonly state: "refused"; readonly message: string };

/** The card's state for the Node's answer about a route. */
export function routeScreenOf(reply: NodeReply<RouteAnswer>): RouteScreen {
  if (reply.ok) return { state: "shown", route: reply.value };
  if (reply.failure.kind === "offline") {
    return { state: "unreachable", message: OFFLINE_PLAN_MESSAGE };
  }
  return { state: "refused", message: reply.failure.reason };
}

/** "Not a road route" for a straight-line fallback, "Road route" otherwise. */
export function roadLabelOf(route: RouteAnswer): string {
  return route.straightLine ? "Not a road route" : "Road route";
}

const MINUTE_MS = 60_000;
/** South Africa time is UTC+2 all year (the same fixed offset the deadline uses, S-8.2-5). */
const SOUTH_AFRICA_OFFSET_MS = 2 * 60 * MINUTE_MS;

/** The Node's route duration in whole minutes, at least one. The arrival estimate is rounded to these minutes. */
export function arrivalMinutes(durationSeconds: number): number {
  return Math.max(1, Math.round(durationSeconds / 60));
}

/** "about 40 minutes", "about 1 hour", "about 1 hour 5 minutes": the duration in words, labelled about (story 8.6). */
export function arrivalWords(durationSeconds: number): string {
  const minutes = arrivalMinutes(durationSeconds);
  if (minutes < 60) return `about ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourWords = `${hours} ${hours === 1 ? "hour" : "hours"}`;
  if (rest === 0) return `about ${hourWords}`;
  return `about ${hourWords} ${rest} ${rest === 1 ? "minute" : "minutes"}`;
}

/** The clock time of a moment in South Africa, as HH:MM. */
export function clockOf(at: number): string {
  const local = new Date(at + SOUTH_AFRICA_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}

/**
 * The planned start and the arrival estimate in one plain sentence (story 8.6). The arrival is the planned start plus the
 * Node's route duration, rounded to the same minutes the words use. Labelled "about": it is not a timed road route.
 */
export function arrivalSentence(windowStart: number, durationSeconds: number): string {
  const minutes = arrivalMinutes(durationSeconds);
  const arrival = clockOf(windowStart + minutes * MINUTE_MS);
  return `Planned start ${clockOf(windowStart)}. Arrival about ${arrival} (${arrivalWords(durationSeconds)}).`;
}
