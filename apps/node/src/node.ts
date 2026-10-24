import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.ts";
import { COMPONENT_NAMES, createStubComponent } from "./components.ts";
import { loadConfig, type LoadOptions } from "./config.ts";
import { createLogger, type LogSink } from "./logger.ts";
import { missingRequiredFor } from "./secrets.ts";
import { readVersion } from "./version.ts";

export interface RunningNode {
  app: FastifyInstance;
  /** The base URL the server is listening on, for example `http://127.0.0.1:8787`. */
  url: string;
  port: number;
  close(): Promise<void>;
}

export interface StartOptions extends LoadOptions {
  /** Where log lines go. Defaults to standard output. */
  sink?: LogSink;
}

/**
 * Loads configuration and secrets, then listens. Throws ConfigError before
 * opening any port if configuration or a required secret is wrong.
 */
export async function startNode(options: StartOptions): Promise<RunningNode> {
  const { config, secrets, configFile } = loadConfig(options);

  const logger = createLogger({
    level: config.logLevel,
    secretValues: secrets.values(),
    ...(options.sink ? { sink: options.sink } : {}),
  });

  const components = COMPONENT_NAMES.map((name) =>
    createStubComponent(name, {
      enabled: config.components[name].enabled,
      secretsPresent: missingRequiredFor(name, secrets).length === 0,
    }),
  );
  const app = buildApp({ logger, version: readVersion(), components });

  await app.listen({ host: config.server.host, port: config.server.port });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : config.server.port;
  const url = `http://${config.server.host}:${port}`;

  logger.info(
    {
      url,
      configFile: configFile ?? null,
      components: Object.fromEntries(COMPONENT_NAMES.map((n) => [n, config.components[n].enabled])),
      loadedKeys: secrets.keys(),
    },
    "ocn node listening",
  );

  return { app, url, port, close: () => app.close() };
}
