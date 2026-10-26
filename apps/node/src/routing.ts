// The Node's `Routing` adapter (story 7.4): the labelled straight-line fallback, used until the South African tiles
// (story 7.2) are released. It is `MemoryRouting` with the release label `straight-line`, so every route it gives says
// it is not a road route. Valhalla is not wired here (decision 7.1: routes are computed on the Node, behind the port).

import { MemoryRouting } from "@shopong/adapters-memory/routing";
import type {
  PortError,
  Result,
  Route,
  RouteErrorCode,
  RouteRequest,
  Routing,
} from "@shopong/ports";

/** The tile release label of a straight-line route. The card shows "not a road route" when a route carries it. */
export const STRAIGHT_LINE = "straight-line";

export class StraightLineRouting implements Routing {
  readonly #inner = new MemoryRouting({ tileRelease: STRAIGHT_LINE });

  route(request: RouteRequest): Promise<Result<Route, PortError<RouteErrorCode>>> {
    return this.#inner.route(request);
  }
}
