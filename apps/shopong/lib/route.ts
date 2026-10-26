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
