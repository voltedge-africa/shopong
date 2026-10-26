import type { FastifyInstance } from "fastify";
import type { AutobaseSharedRecord } from "@shopong/record-autobase";
import { buildApp } from "./app.ts";
import { COMPONENT_NAMES, createStubComponent } from "./components.ts";
import { loadConfig, type LoadOptions } from "./config.ts";
import { createLogger, type LogSink } from "./logger.ts";
import { openRecordComponent } from "./record.ts";
import { missingRequiredFor } from "./secrets.ts";
import { readVersion } from "./version.ts";

export interface RunningNode {
  app: FastifyInstance;
  /** The base URL the server is listening on, for example `http://127.0.0.1:8787`. */
  url: string;
  port: number;
  /** The shared record on the data folder, or undefined when the record component is off. */
  record: AutobaseSharedRecord<unknown> | undefined;
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

  const opened = config.components.record.enabled
    ? await openRecordComponent(config.dataDir, secrets)
    : undefined;
  const components = COMPONENT_NAMES.map((name) =>
    name === "record" && opened !== undefined
      ? opened.component
      : createStubComponent(name, {
          enabled: config.components[name].enabled,
          secretsPresent: missingRequiredFor(name, secrets).length === 0,
        }),
  );
  let app: FastifyInstance;
  try {
    app = buildApp({ logger, version: readVersion(), components });
    await app.listen({ host: config.server.host, port: config.server.port });
  } catch (error) {
    // Nothing else owns the record yet, so a failed start must not leave its files locked.
    await opened?.record.close();
    throw error;
  }
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : config.server.port;
  const url = `http://${config.server.host}:${port}`;

  logger.info(
    {
      url,
      configFile: configFile ?? null,
      dataDir: config.dataDir,
      components: Object.fromEntries(COMPONENT_NAMES.map((n) => [n, config.components[n].enabled])),
      loadedKeys: secrets.keys(),
    },
    "ocn node listening",
  );

  return {
    app,
    url,
    port,
    record: opened?.record,
    close: async () => {
      await app.close();
      await opened?.record.close();
    },
  };
}
