import type { FastifyInstance } from "fastify";
import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import type { AutobaseSharedRecord } from "@shopong/record-autobase";
import type { Did, Ledger } from "@shopong/ports";
import { buildApp } from "./app.ts";
import { COMPONENT_NAMES, createStubComponent } from "./components.ts";
import { loadConfig, type LoadOptions } from "./config.ts";
import { ReplicaHub } from "./hub.ts";
import { createLogger, type LogSink } from "./logger.ts";
import { masterKeyOf, nodeIdentityOf, openRecordComponent } from "./record.ts";
import { missingRequiredFor } from "./secrets.ts";
import { readVersion } from "./version.ts";

export interface RunningNode {
  app: FastifyInstance;
  /** The base URL the server is listening on, for example `http://127.0.0.1:8787`. */
  url: string;
  port: number;
  /** The shared record on the data folder, or undefined when the record component is off. */
  record: AutobaseSharedRecord<unknown> | undefined;
  /** The member replicas and the indexer's sync surface, or undefined when the record component is off. */
  hub: ReplicaHub | undefined;
  /** The Node's own identity (record.ts), or undefined when the record component is off. */
  nodeIdentity: Did | undefined;
  close(): Promise<void>;
}

export interface StartOptions extends LoadOptions {
  /** Where log lines go. Defaults to standard output. */
  sink?: LogSink;
  /**
   * The books the pool read uses (story 4.6). Absent, the pool route answers 503 "The books can't be read right now.".
   * Configured by the caller; the ledger's own file and its wiring are not part of this story.
   */
  ledger?: Ledger;
}

/**
 * Runs each step in order even when an earlier one throws, then rethrows the first failure. Used to stop the
 * Node: the record is closed last and always, so its files are released even when the hub fails to stop.
 */
export async function closeInOrder(steps: readonly (() => unknown)[]): Promise<void> {
  let first: unknown;
  let failed = false;
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      if (!failed) first = error;
      failed = true;
    }
  }
  if (failed) throw first;
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
  const auth = new IsoUcanCapabilityAuth();
  let hub: ReplicaHub | undefined;
  let app: FastifyInstance;
  const identity = opened === undefined ? undefined : await nodeIdentityOf(masterKeyOf(secrets));
  try {
    hub =
      opened === undefined
        ? undefined
        : new ReplicaHub({
            dataDir: config.dataDir,
            masterKey: masterKeyOf(secrets),
            indexer: opened.record,
            auth,
            maxCommunities: config.maxCommunities,
          });
    app = buildApp({
      logger,
      version: readVersion(),
      components,
      auth,
      sync: hub === undefined ? {} : { hub },
      ...(hub === undefined ? {} : { communities: hub }),
      pool: {
        ...(hub === undefined ? {} : { hub }),
        ...(options.ledger === undefined ? {} : { ledger: options.ledger }),
        ...(identity === undefined
          ? {}
          : { masterKey: masterKeyOf(secrets), nodeIdentity: identity }),
      },
      allowedCreators: config.allowedCreators,
      cors: { origins: config.corsOrigins, environment: config.environment },
    });
    await app.listen({ host: config.server.host, port: config.server.port });
  } catch (error) {
    // Nothing else owns the record yet, so a failed start must not leave its files locked.
    await closeInOrder([() => hub?.close(), () => opened?.record.close()]);
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
    hub,
    nodeIdentity: identity,
    close: () =>
      closeInOrder([() => app.close(), () => hub?.close(), () => opened?.record.close()]),
  };
}
