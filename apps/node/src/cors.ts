// Browser access to the Node's routes (story 3.4). The web build of the app runs on another origin, so a browser
// sends a preflight `OPTIONS` before each signed request. Only origins listed in the config are allowed. A wildcard
// is accepted only in the development environment (`config.ts` refuses it otherwise). Nothing is allowed unless
// listed: with no origins configured no CORS header is sent at all.

import type { FastifyInstance } from "fastify";
import type { Environment } from "./config.ts";

/** The request headers a browser may send to the Node: the signed-request headers and a JSON body. */
export const ALLOWED_HEADERS = [
  "content-type",
  "x-ocn-actor",
  "x-ocn-nonce",
  "x-ocn-signature",
  "x-ocn-time",
];
export const ALLOWED_METHODS = ["GET", "POST", "OPTIONS"];
/** How long a browser may cache a preflight answer. */
export const PREFLIGHT_MAX_AGE_SECONDS = 600;

export interface CorsOptions {
  readonly origins: readonly string[];
  readonly environment: Environment;
}

/** The origin to echo back, or undefined when `origin` is not allowed. A wildcard answers `*` in development only. */
export function allowedOrigin(
  options: CorsOptions,
  origin: string | undefined,
): string | undefined {
  if (origin === undefined || origin === "") return undefined;
  if (options.origins.includes(origin)) return origin;
  if (options.environment === "development" && options.origins.includes("*")) return "*";
  return undefined;
}

/** Adds the CORS headers for allowed origins and answers preflights. Registered before every route. */
export function registerCors(app: FastifyInstance, options: CorsOptions): void {
  if (options.origins.length === 0) return;
  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    const allowed = allowedOrigin(options, typeof origin === "string" ? origin : undefined);
    reply.header("vary", "Origin");
    if (allowed === undefined) {
      if (request.method === "OPTIONS") return reply.code(204).send();
      return;
    }
    reply.header("access-control-allow-origin", allowed);
    if (request.method === "OPTIONS") {
      reply.header("access-control-allow-methods", ALLOWED_METHODS.join(", "));
      reply.header("access-control-allow-headers", ALLOWED_HEADERS.join(", "));
      reply.header("access-control-max-age", String(PREFLIGHT_MAX_AGE_SECONDS));
      return reply.code(204).send();
    }
  });
}
