import { registerRouteRoutes, type RouteRouteOptions } from "./route-routes.ts";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import {
  COMPONENT_NAMES,
  type ComponentHealth,
  type ComponentName,
  type NodeComponent,
} from "./components.ts";
import { createAuthorityGuard, type AuthorityConfig } from "./authority.ts";
import { registerCommitmentRoute } from "./commitment-route.ts";
import { keepRawJsonBody } from "./signed.ts";
import { registerCors, type CorsOptions } from "./cors.ts";
import { registerCommunityRoutes, type CommunityHub } from "./community-routes.ts";
import { registerPoolRoute, type PoolRouteOptions } from "./pool-routes.ts";
import { registerSyncRoutes, type SyncOptions } from "./sync.ts";
import { registerPaymentRoutes } from "./payments-routes.ts";
import {
  registerPaymentRequestRoutes,
  type PaymentRequestOptions,
} from "./payment-request-route.ts";
import { registerCheckingRoute, type CheckingRouteOptions } from "./checking-routes.ts";
import type { ConfirmationDeps } from "./payment-confirmation.ts";
import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import type { SimulatedStitch } from "@shopong/adapter-stitch-sim";
import type { CapabilityAuth, Commitments } from "@shopong/ports";

export type OverallStatus = "ok" | "degraded";

export interface HealthReport {
  status: OverallStatus;
  version: string;
  components: Record<ComponentName, ComponentHealth>;
}

export interface AppOptions {
  logger: FastifyBaseLogger;
  version: string;
  components: readonly NodeComponent[];
  /** Verifies signatures and capability chains. Defaults to a fresh `IsoUcanCapabilityAuth`. */
  auth?: CapabilityAuth;
  /** The community the Node checks authority against. Without it, `/authority/check` answers 503. */
  authority?: AuthorityConfig;
  /** The signed sync routes. Always registered; without a hub (record off) they answer 503. */
  sync?: SyncOptions;
  /** Commits personal values for `POST /commitments` (story 2.7). Without it, that route answers 503. */
  commitments?: Commitments;
  /** Browser origins allowed to call the routes. Default: none, so no CORS header is sent. */
  cors?: CorsOptions;
  /** Creates and admits communities (story 3.4). Without it, the community routes answer 503. */
  communities?: CommunityHub;
  /** DIDs allowed to create communities. Empty means open (local development only). */
  allowedCreators?: readonly string[];
  /** Size of each community route's one-time-number table (review N2). */
  communityNonces?: { readonly create?: number; readonly members?: number };
  /** The pool read (story 4.6). Without a ledger the route answers 503. */
  pool?: PoolRouteOptions;
  /** Route planning and places (story 7.4). Without it, the route routes are not served. */
  routes?: RouteRouteOptions;
  /** The simulated payments (story 4.4). Without it, the payment routes are not served. */
  payments?: SimulatedStitch;
  /** The member's pay routes for a pledge (story 4.3). Without it, they are not served. */
  paymentRequests?: PaymentRequestOptions;
  /** Confirms a verified pay-in webhook: books, record, status, in order (story 4.5). Without it, the webhook only sets status. */
  paymentConfirmation?: ConfirmationDeps;
  /** The treasurer's "Needs checking" list (story 4.5). Without it, the route is not served. */
  checking?: CheckingRouteOptions;
  /** Sets up a new community's books chart when it is made (story 4.5). */
  books?: { readonly configureCommunity: (communityKey: string) => Promise<void> };
}

async function report(options: AppOptions): Promise<HealthReport> {
  const entries = await Promise.all(
    options.components.map(async (component): Promise<[ComponentName, ComponentHealth]> => {
      try {
        return [component.name, await component.check()];
      } catch {
        return [component.name, { status: "error" }];
      }
    }),
  );
  const components = Object.fromEntries(
    COMPONENT_NAMES.map((name) => [
      name,
      entries.find(([n]) => n === name)?.[1] ?? { status: "error" },
    ]),
  ) as Record<ComponentName, ComponentHealth>;
  const healthy = Object.values(components).every(
    (c) => c.status === "ok" || c.status === "disabled",
  );
  return { status: healthy ? "ok" : "degraded", version: options.version, components };
}

/**
 * The Node's HTTP surface. `/health` always answers 200 with the report while
 * the process is alive; `/ready` answers 503 until every enabled component is ok.
 */
export function buildApp(options: AppOptions): FastifyInstance {
  const app: FastifyInstance = Fastify({ loggerInstance: options.logger });
  const auth = options.auth ?? new IsoUcanCapabilityAuth();

  app.get("/health", async () => report(options));

  app.get("/ready", async (_request, reply) => {
    const health = await report(options);
    return reply
      .code(health.status === "ok" ? 200 : 503)
      .send({ ready: health.status === "ok", ...health });
  });

  registerCors(app, options.cors ?? { origins: [], environment: "production" });
  keepRawJsonBody(app);
  createAuthorityGuard({ auth, config: options.authority }).register(app);
  registerCommitmentRoute(app, {
    auth,
    commitments: options.commitments,
    config: options.authority,
  });
  registerSyncRoutes(app, auth, options.sync ?? {});
  registerPoolRoute(app, auth, options.pool ?? {});
  if (options.routes !== undefined) registerRouteRoutes(app, auth, options.routes);
  if (options.payments !== undefined) {
    registerPaymentRoutes(app, options.payments, options.paymentConfirmation);
  }
  if (options.checking !== undefined) registerCheckingRoute(app, auth, options.checking);
  if (options.paymentRequests !== undefined) {
    registerPaymentRequestRoutes(app, options.paymentRequests);
  }
  if (options.communities !== undefined) {
    registerCommunityRoutes(app, {
      hub: options.communities,
      auth,
      allowedCreators: options.allowedCreators ?? [],
      ...(options.books === undefined ? {} : { onCreated: options.books.configureCommunity }),
      ...(options.communityNonces === undefined ? {} : { nonces: options.communityNonces }),
    });
  }

  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: "not-found" }));

  return app;
}
