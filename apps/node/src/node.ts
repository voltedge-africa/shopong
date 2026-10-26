import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import { SIMULATED_MODE, type SimulatedStitch } from "@shopong/adapter-stitch-sim";
import { configureChart, openSqliteLedger } from "@shopong/ledger-sqlite";
import type { AutobaseSharedRecord } from "@shopong/record-autobase";
import type { Did, Ledger } from "@shopong/ports";
import { buildApp } from "./app.ts";
import { COMPONENT_NAMES, createStubComponent, type NodeComponent } from "./components.ts";
import { loadConfig, type LoadOptions } from "./config.ts";
import { ReplicaHub } from "./hub.ts";
import { createLogger, type LogSink } from "./logger.ts";
import { masterKeyOf, nodeIdentityOf, openRecordComponent } from "./record.ts";
import { ConfigError, missingRequiredFor } from "./secrets.ts";
import { openSimulatedPayments, paymentsComponent } from "./payments.ts";
import { openCheckingStore, type ConfirmationDeps } from "./payment-confirmation.ts";
import { startChecking, type RunningChecking } from "./reconciler.ts";
import { readVersion } from "./version.ts";

/** The books' file in the data folder (story 4.5): the SQLite ledger the Node runs in production. */
export const LEDGER_FILE = "ledger.sqlite";

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
  /** The simulated payments (story 4.4), or undefined when the payments component is off. */
  payments: SimulatedStitch | undefined;
  /** The books in use (the injected ledger, or the SQLite file), or undefined when the books are off. */
  ledger: Ledger | undefined;
  /** The reconciler (story 4.5), or undefined unless payments, the record and the books are all on. */
  checking: RunningChecking | undefined;
  close(): Promise<void>;
}

export interface StartOptions extends LoadOptions {
  /** Where log lines go. Defaults to standard output. */
  sink?: LogSink;
  /**
   * The books the pool read uses (story 4.6). Absent, the Node opens its SQLite ledger when the ledger component is on,
   * and the pool route answers 503 when it is off.
   */
  ledger?: Ledger;
  /** Test seams for the confirmation's crash points (story 4.5). Never set in production. */
  faults?: {
    readonly beforeRecord?: (eventType: string) => void;
    readonly failRecordWrite?: (eventType: string) => boolean;
  };
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

  // A payment is confirmed into the shared record (story 4.5), so payments cannot run without it.
  if (config.components.payments.enabled && !config.components.record.enabled) {
    throw new ConfigError(
      "payments need the record: payments are confirmed into the shared record, so enable the record component too",
    );
  }

  const logger = createLogger({
    level: config.logLevel,
    secretValues: secrets.values(),
    ...(options.sink ? { sink: options.sink } : {}),
  });

  const opened = config.components.record.enabled
    ? await openRecordComponent(config.dataDir, secrets)
    : undefined;
  const auth = new IsoUcanCapabilityAuth();
  let hub: ReplicaHub | undefined;
  let payments: SimulatedStitch | undefined;
  let books: Ledger | undefined;
  // The SQLite books this Node opened (not an injected ledger): closed with the Node.
  let ownedBooks: { close(): void } | undefined;
  let checking: RunningChecking | undefined;
  let app: FastifyInstance;
  const identity = opened === undefined ? undefined : await nodeIdentityOf(masterKeyOf(secrets));
  try {
    payments = config.components.payments.enabled
      ? openSimulatedPayments({
          dataDir: config.dataDir,
          secrets,
          log: (line) => logger.warn({ simulated: true, mode: SIMULATED_MODE }, line),
        })
      : undefined;
    // The books: an injected ledger (tests), or the SQLite file in the data folder when the ledger component is on.
    if (options.ledger !== undefined) {
      books = options.ledger;
    } else if (config.components.ledger.enabled) {
      mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
      const sqlite = openSqliteLedger({
        path: join(config.dataDir, LEDGER_FILE),
        clock: { now: Date.now },
      });
      books = sqlite;
      ownedBooks = sqlite;
    }
    const components: NodeComponent[] = COMPONENT_NAMES.map((name) => {
      if (name === "record" && opened !== undefined) return opened.component;
      if (name === "payments") return paymentsComponent(config.components.payments.enabled);
      // An injected ledger (story 4.6) is the books in use: health says so, rather than reading the config switch.
      if (name === "ledger" && options.ledger !== undefined)
        return createStubComponent(name, { enabled: true, secretsPresent: true });
      if (name === "ledger" && ownedBooks !== undefined) {
        return { name, check: async () => ({ status: "ok", mode: "sqlite" }) };
      }
      return createStubComponent(name, {
        enabled: config.components[name].enabled,
        secretsPresent: missingRequiredFor(name, secrets, config.paymentsAdapter).length === 0,
      });
    });
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

    // Confirmation of simulated payments (story 4.5): the books, the record and the status, in order.
    const confirmation: ConfirmationDeps | undefined =
      payments === undefined || hub === undefined || identity === undefined
        ? undefined
        : {
            simulated: payments,
            ledger: books,
            hub,
            masterKey: masterKeyOf(secrets),
            nodeIdentity: identity,
            store: openCheckingStore(config.dataDir, (message) =>
              logger.warn({ simulated: true, mode: SIMULATED_MODE }, message),
            ),
            now: Date.now,
            ...(options.faults?.beforeRecord === undefined
              ? {}
              : { beforeRecord: options.faults.beforeRecord }),
            ...(options.faults?.failRecordWrite === undefined
              ? {}
              : { failRecordWrite: options.faults.failRecordWrite }),
          };

    app = buildApp({
      logger,
      version: readVersion(),
      components,
      auth,
      sync: hub === undefined ? {} : { hub },
      ...(hub === undefined ? {} : { communities: hub }),
      pool: {
        ...(hub === undefined ? {} : { hub }),
        simulated: payments !== undefined,
        ...(books === undefined ? {} : { ledger: books }),
        ...(identity === undefined
          ? {}
          : { masterKey: masterKeyOf(secrets), nodeIdentity: identity }),
      },
      allowedCreators: config.allowedCreators,
      cors: { origins: config.corsOrigins, environment: config.environment },
      ...(payments === undefined ? {} : { payments }),
      ...(confirmation === undefined ? {} : { paymentConfirmation: confirmation }),
      ...(confirmation === undefined || hub === undefined
        ? {}
        : { checking: { hub, store: confirmation.store } }),
      ...(books === undefined
        ? {}
        : {
            books: {
              configureCommunity: async (communityKey: string) => {
                const chart = await configureChart(books!, communityKey);
                if (!chart.ok) throw new Error(chart.error.message);
              },
            },
          }),
    });
    await app.listen({ host: config.server.host, port: config.server.port });

    // The reconciler runs once now and then every 15 minutes (story 4.5). It needs all three readings to compare.
    if (confirmation !== undefined && books !== undefined && payments !== undefined) {
      checking = startChecking({
        simulated: payments,
        ledger: books,
        hub: confirmation.hub,
        masterKey: confirmation.masterKey,
        nodeIdentity: confirmation.nodeIdentity,
        store: confirmation.store,
        now: confirmation.now,
        log: (message, fields) => logger.info(fields, message),
      });
      checking.lastRun.catch(() => undefined);
    } else if (payments !== undefined) {
      logger.warn(
        { simulated: true, mode: SIMULATED_MODE },
        "payment check not running: it needs the books (ledger) on (simulated)",
      );
    }
  } catch (error) {
    // Nothing else owns the record yet, so a failed start must not leave its files locked.
    checking?.close();
    await closeInOrder([
      () => hub?.close(),
      () => opened?.record.close(),
      () => ownedBooks?.close(),
    ]);
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
      paymentsAdapter: config.paymentsAdapter,
      paymentsMode: payments === undefined ? null : SIMULATED_MODE,
      loadedKeys: secrets.keys(),
    },
    "ocn node listening",
  );
  if (payments !== undefined) {
    logger.warn(
      { simulated: true, mode: SIMULATED_MODE },
      "payments are SIMULATED (simulated-stitch): no money moves, no bank is contacted and no Stitch account is used",
    );
  }

  return {
    app,
    url,
    port,
    record: opened?.record,
    hub,
    nodeIdentity: identity,
    payments,
    ledger: books,
    checking,
    close: () =>
      closeInOrder([
        () => checking?.close(),
        () => app.close(),
        () => hub?.close(),
        () => opened?.record.close(),
        () => ownedBooks?.close(),
      ]),
  };
}
