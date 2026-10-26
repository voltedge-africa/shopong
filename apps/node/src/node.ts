import type { FastifyInstance } from "fastify";
import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import { SIMULATED_MODE, type SimulatedStitch } from "@shopong/adapter-stitch-sim";
import type { AutobaseSharedRecord } from "@shopong/record-autobase";
import type { Did, Ledger } from "@shopong/ports";
import { buildApp } from "./app.ts";
import { COMPONENT_NAMES, createStubComponent, type NodeComponent } from "./components.ts";
import { loadConfig, type LoadOptions } from "./config.ts";
import { ReplicaHub } from "./hub.ts";
import { createLogger, type LogSink } from "./logger.ts";
import { masterKeyOf, nodeIdentityOf, openRecordComponent } from "./record.ts";
import { missingRequiredFor, type ResolvedSecrets } from "./secrets.ts";
import { openSimulatedPayments, paymentsComponent } from "./payments.ts";
import { communitySecretFromHex, nodeHmacSha512 } from "./commitments.ts";

import { payerCommitmentOf, type PaymentRequestOptions } from "./payment-request-route.ts";
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
  /** The simulated payments (story 4.4), or undefined when the payments component is off. */
  payments: SimulatedStitch | undefined;
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
 * The member pay routes' options (story 4.3), when the simulated payments and the record are both on. The payer
 * reference is committed with the community secret; without it the routes answer 503 (the phone is told plainly).
 */
export function paymentRequestOptionsOf(options: {
  readonly auth: IsoUcanCapabilityAuth;
  readonly hub: ReplicaHub | undefined;
  readonly payments: SimulatedStitch | undefined;
  readonly secrets: ResolvedSecrets;
  /** The Node's did:key identity (`nodeIdentityOf`), or undefined when the record is off. */
  readonly identity: Did | undefined;
}): PaymentRequestOptions | undefined {
  const { auth, hub, payments, secrets, identity } = options;
  if (identity === undefined) return undefined;
  if (hub === undefined || payments === undefined) return undefined;
  const hex = secrets.get("COMMUNITY_SECRET");
  const secret = hex === undefined ? undefined : communitySecretFromHex(hex);
  return {
    auth,
    payments,
    hub,
    nodeIdentity: identity,
    payerCommitment: async (community, member) => {
      if (secret === undefined) return undefined;
      try {
        // Keyed per community (review item 3): the same member has a different reference in each community.
        return await payerCommitmentOf(secret, community, member, nodeHmacSha512);
      } catch {
        return undefined;
      }
    },
  };
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
  const auth = new IsoUcanCapabilityAuth();
  let hub: ReplicaHub | undefined;
  let payments: SimulatedStitch | undefined;
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
    const components: NodeComponent[] = COMPONENT_NAMES.map((name) => {
      if (name === "record" && opened !== undefined) return opened.component;
      if (name === "payments") return paymentsComponent(config.components.payments.enabled);
      // An injected ledger (story 4.6) is the books in use: health says so, rather than reading the config switch.
      if (name === "ledger" && options.ledger !== undefined)
        return createStubComponent(name, { enabled: true, secretsPresent: true });
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
    const paymentRequests = paymentRequestOptionsOf({ auth, hub, payments, secrets, identity });
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
      ...(payments === undefined ? {} : { payments }),
      ...(paymentRequests === undefined ? {} : { paymentRequests }),
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
    close: () =>
      closeInOrder([() => app.close(), () => hub?.close(), () => opened?.record.close()]),
  };
}
