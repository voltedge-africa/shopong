import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import {
  COMPONENT_NAMES,
  type ComponentHealth,
  type ComponentName,
  type NodeComponent,
} from "./components.ts";

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

  app.get("/health", async () => report(options));

  app.get("/ready", async (_request, reply) => {
    const health = await report(options);
    return reply
      .code(health.status === "ok" ? 200 : 503)
      .send({ ready: health.status === "ok", ...health });
  });

  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: "not-found" }));

  return app;
}
