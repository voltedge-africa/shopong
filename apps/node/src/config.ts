// Typed configuration: defaults, then an optional JSON config file, then
// environment variables. Secrets are not part of this: a config file that
// contains a secret key is refused, and secrets come only from the environment
// (see secrets.ts).

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { isSafeReleaseName } from "@shopong/tile-release";
import { COMPONENT_NAMES, type ComponentName } from "./components.ts";
import {
  ConfigError,
  resolveSecrets,
  SECRET_KEYS,
  type PaymentsAdapterName,
  type ResolvedSecrets,
} from "./secrets.ts";
import { looksLikeSecretKey } from "./redact.ts";

export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

/**
 * `production` is the default and refuses a wildcard CORS origin. `development` lets `*` through, so a web
 * build on another port can reach a local Node. Exact origins are allowed in both.
 */
export const ENVIRONMENTS = ["production", "development"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export const DEFAULT_PORT = 8787;
export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_DATA_DIR = "ocn-data";

/** Defaults: record and queue run in memory; ledger and payments need secrets, so they start off. */
const DEFAULT_ENABLED: Readonly<Record<ComponentName, boolean>> = {
  record: true,
  ledger: false,
  payments: false,
  queue: true,
};

const portSchema = z.number().int().min(0).max(65535);
const hostSchema = z.string().min(1);
const logLevelSchema = z.enum(LOG_LEVELS);
const environmentSchema = z.enum(ENVIRONMENTS);
const corsOriginSchema = z
  .string()
  .refine((v) => v === "*" || /^https?:\/\/[^/\s?#]+$/u.test(v), "origin");
const componentFileSchema = z.strictObject({ enabled: z.boolean().optional() });
const releaseNameSchema = z.string().refine(isSafeReleaseName, "release");

const didSchema = z.string().regex(/^did:key:z[1-9A-HJ-NP-Za-km-z]+$/u, "did");
export const DEFAULT_MAX_COMMUNITIES = 50;

const fileSchema = z.strictObject({
  dataDir: z.string().min(1).optional(),
  /** The most communities this Node will host, in all (review N1). Default 50. */
  maxCommunities: z.number().int().min(1).max(100_000).optional(),
  /** DIDs allowed to create communities. Empty (the default) means open: for local development only. */
  allowedCreators: z.array(didSchema).optional(),
  server: z.strictObject({ host: hostSchema.optional(), port: portSchema.optional() }).optional(),
  logLevel: logLevelSchema.optional(),
  environment: environmentSchema.optional(),
  cors: z.strictObject({ origins: z.array(corsOriginSchema).optional() }).optional(),
  components: z
    .strictObject({
      record: componentFileSchema.optional(),
      ledger: componentFileSchema.optional(),
      payments: componentFileSchema.optional(),
      queue: componentFileSchema.optional(),
    })
    .optional(),
  /** Map tile releases (story 7.2): the folder outside the data folder, and the release the Node serves as active. */
  tiles: z
    .strictObject({
      releasesDir: z.string().min(1).optional(),
      activeRelease: releaseNameSchema.optional(),
    })
    .optional(),
});

export interface NodeConfig {
  /** The Node's data folder. Everything the Node stores on disk goes under it. */
  dataDir: string;
  server: { host: string; port: number };
  logLevel: (typeof LOG_LEVELS)[number];
  components: Record<ComponentName, { enabled: boolean }>;
  environment: Environment;
  /** The most communities hosted on this Node, all creators together. */
  maxCommunities: number;
  /** DIDs allowed to create communities. Empty means open (local development only). */
  allowedCreators: string[];
  /** Browser origins allowed to call the Node's routes (exact, for example `https://app.example`). Empty by default. */
  corsOrigins: string[];
  /** Which payments adapter runs. `simulated` is the only one available (story 4.4). */
  paymentsAdapter: PaymentsAdapterName;
  /** Lets the simulation run in a production environment. Off by default (review item 1). */
  allowSimulatedPayments: boolean;
  /** Map tile releases (story 7.2). Nothing is served until `releasesDir` is set. */
  tiles: {
    /** The releases folder. It must sit outside the data folder. */
    releasesDir: string | undefined;
    /** The release served at `/map/active/...`. Optional: without it the alias answers "No map data yet." */
    activeRelease: string | undefined;
  };
}

export interface LoadedConfig {
  config: NodeConfig;
  secrets: ResolvedSecrets;
  /** The config file that was read, if any. */
  configFile: string | undefined;
}

type Env = Readonly<Record<string, string | undefined>>;

export interface LoadOptions {
  env: Env;
  /** `--config <path>` from the command line, if given. Wins over OCN_NODE_CONFIG. */
  configPath?: string | undefined;
  readFile?: (path: string) => string;
  readSecretFile?: (path: string) => string;
}

/** Messages carry the path and the rule that failed, never the offending value. */
function describeIssues(source: string, error: z.ZodError): string {
  const parts = error.issues.map((issue) => {
    const where = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    if (issue.code === "unrecognized_keys") {
      return `${where}: unknown key(s) ${issue.keys.map((k) => JSON.stringify(k)).join(", ")}`;
    }
    return `${where}: ${issue.code}`;
  });
  return `invalid ${source}: ${parts.join("; ")}`;
}

function parseEnvBoolean(name: string, raw: string): boolean {
  const v = raw.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(v)) return true;
  if (["false", "0", "no", "off"].includes(v)) return false;
  throw new ConfigError(`invalid environment variable ${name}: expected true or false`);
}

/** Every key at every depth, so a secret key hidden in a nested object is still found. */
function collectKeys(value: unknown, into: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, into);
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      into.push(key);
      collectKeys(child, into);
    }
  }
  return into;
}

function readConfigFile(path: string, readFile: (p: string) => string): z.infer<typeof fileSchema> {
  let text: string;
  try {
    text = readFile(path);
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    throw new ConfigError(
      `config file ${path} could not be read (${typeof code === "string" ? code : "UNKNOWN"})`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // The parser's message can quote file content, so say only where.
    throw new ConfigError(`config file ${path} is not valid JSON`);
  }
  const secretKeys = [
    ...new Set(
      collectKeys(raw).filter(
        (k) => SECRET_KEYS.includes(k.toUpperCase()) || looksLikeSecretKey(k),
      ),
    ),
  ];
  if (secretKeys.length > 0) {
    throw new ConfigError(
      `config file ${path} must not contain secrets (found key(s): ${secretKeys.join(", ")}); ` +
        `set them as environment variables or as KEY_FILE paths instead`,
      secretKeys,
    );
  }
  const parsed = fileSchema.safeParse(raw);
  if (!parsed.success) throw new ConfigError(describeIssues(`config file ${path}`, parsed.error));
  return parsed.data;
}

/**
 * Map releases are public data served by the Node, so their folder must sit outside the data folder. The active
 * release can only be named when there is a folder to find it in.
 */
function checkTiles(config: NodeConfig): void {
  const { releasesDir, activeRelease } = config.tiles;
  if (activeRelease !== undefined && releasesDir === undefined) {
    throw new ConfigError("tiles.activeRelease needs tiles.releasesDir (or OCN_NODE_TILES_DIR)");
  }
  if (releasesDir === undefined) return;
  // Real paths, so a symbolic link cannot place the releases folder inside the data folder, or the reverse.
  const data = realPathOf(config.dataDir);
  const releases = realPathOf(releasesDir);
  if (isWithin(data, releases)) {
    throw new ConfigError(
      "tiles.releasesDir must be outside the data folder (the data folder holds private state)",
    );
  }
  if (isWithin(releases, data)) {
    throw new ConfigError("tiles.releasesDir must not contain the data folder");
  }
}

/** Whether `child` is `parent` or inside it, by path text (both already resolved to real paths). */
function isWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (rel.split(sep)[0] !== ".." && !isAbsolute(rel));
}

/** The real path of the nearest existing ancestor, with the rest of the path added back. */
function realPathOf(path: string): string {
  let probe = resolve(path);
  const rest: string[] = [];
  while (!existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) break;
    rest.unshift(basename(probe));
    probe = parent;
  }
  return join(realpathSync(probe), ...rest);
}

/** Loads and validates the configuration and the secrets. Throws ConfigError; never returns a partial result. */
export function loadConfig(options: LoadOptions): LoadedConfig {
  const { env } = options;
  const readFile = options.readFile ?? ((p: string) => readFileSync(p, "utf8"));

  const configFile = options.configPath ?? (env["OCN_NODE_CONFIG"] || undefined);
  const file = configFile ? readConfigFile(configFile, readFile) : {};

  const merged: NodeConfig = {
    dataDir: file.dataDir ?? DEFAULT_DATA_DIR,
    server: {
      host: file.server?.host ?? DEFAULT_HOST,
      port: file.server?.port ?? DEFAULT_PORT,
    },
    logLevel: file.logLevel ?? "info",
    environment: file.environment ?? "production",
    maxCommunities: file.maxCommunities ?? DEFAULT_MAX_COMMUNITIES,
    allowedCreators: [...(file.allowedCreators ?? [])],
    corsOrigins: [...(file.cors?.origins ?? [])],
    paymentsAdapter: "simulated",
    allowSimulatedPayments: false,
    tiles: {
      releasesDir: file.tiles?.releasesDir,
      activeRelease: file.tiles?.activeRelease,
    },
    components: Object.fromEntries(
      COMPONENT_NAMES.map((name) => [
        name,
        { enabled: file.components?.[name]?.enabled ?? DEFAULT_ENABLED[name] },
      ]),
    ) as NodeConfig["components"],
  };

  // Environment wins over the file.
  const envDataDir = env["OCN_NODE_DATA_DIR"];
  if (envDataDir) merged.dataDir = envDataDir;
  const envHost = env["OCN_NODE_HOST"];
  if (envHost) merged.server.host = envHost;
  const envPort = env["OCN_NODE_PORT"];
  if (envPort) {
    const port = portSchema.safeParse(/^\d+$/u.test(envPort) ? Number(envPort) : Number.NaN);
    if (!port.success) {
      throw new ConfigError("invalid environment variable OCN_NODE_PORT: expected 0-65535");
    }
    merged.server.port = port.data;
  }
  const envEnvironment = env["OCN_NODE_ENVIRONMENT"];
  if (envEnvironment) {
    const parsed = environmentSchema.safeParse(envEnvironment);
    if (!parsed.success) {
      throw new ConfigError(
        `invalid environment variable OCN_NODE_ENVIRONMENT: expected one of ${ENVIRONMENTS.join(", ")}`,
      );
    }
    merged.environment = parsed.data;
  }
  const envMax = env["OCN_NODE_MAX_COMMUNITIES"];
  if (envMax) {
    const parsed = /^\d+$/u.test(envMax) ? Number(envMax) : Number.NaN;
    if (!(Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 100_000)) {
      throw new ConfigError(
        "invalid environment variable OCN_NODE_MAX_COMMUNITIES: expected 1 to 100000",
      );
    }
    merged.maxCommunities = parsed;
  }
  const envCreators = env["OCN_NODE_ALLOWED_CREATORS"];
  if (envCreators) {
    const dids = envCreators
      .split(",")
      .map((d) => d.trim())
      .filter((d) => d !== "");
    if (!dids.every((d) => didSchema.safeParse(d).success)) {
      throw new ConfigError(
        "invalid environment variable OCN_NODE_ALLOWED_CREATORS: expected comma-separated did:key identities",
      );
    }
    merged.allowedCreators = dids;
  }
  const envOrigins = env["OCN_NODE_CORS_ORIGINS"];
  if (envOrigins) {
    const origins = envOrigins
      .split(",")
      .map((o) => o.trim())
      .filter((o) => o !== "");
    if (!origins.every((o) => corsOriginSchema.safeParse(o).success)) {
      throw new ConfigError(
        "invalid environment variable OCN_NODE_CORS_ORIGINS: expected comma-separated origins such as https://app.example",
      );
    }
    merged.corsOrigins = origins;
  }
  const envLevel = env["OCN_NODE_LOG_LEVEL"];
  if (envLevel) {
    const level = logLevelSchema.safeParse(envLevel);
    if (!level.success) {
      throw new ConfigError(
        `invalid environment variable OCN_NODE_LOG_LEVEL: expected one of ${LOG_LEVELS.join(", ")}`,
      );
    }
    merged.logLevel = level.data;
  }
  const envAdapter = env["PAYMENTS_ADAPTER"];
  if (envAdapter !== undefined && envAdapter !== "") {
    if (envAdapter === "stitch") {
      // Refused rather than accepted: no Stitch adapter has passed the Payments contract yet (story 4.4).
      throw new ConfigError(
        "PAYMENTS_ADAPTER=stitch is refused: no Stitch adapter has passed the Payments contract yet. " +
          "Use PAYMENTS_ADAPTER=simulated, which is a simulation and is labelled as one everywhere.",
      );
    }
    if (envAdapter !== "simulated") {
      throw new ConfigError(
        "invalid environment variable PAYMENTS_ADAPTER: expected simulated or stitch",
      );
    }
  }
  const envTilesDir = env["OCN_NODE_TILES_DIR"];
  if (envTilesDir) merged.tiles.releasesDir = envTilesDir;
  const envTilesRelease = env["OCN_NODE_TILES_RELEASE"];
  if (envTilesRelease) {
    if (!isSafeReleaseName(envTilesRelease)) {
      throw new ConfigError(
        "invalid environment variable OCN_NODE_TILES_RELEASE: expected a release name such as kwazulu-natal-2026-10-23",
      );
    }
    merged.tiles.activeRelease = envTilesRelease;
  }
  checkTiles(merged);
  const envAllowSim = env["OCN_NODE_ALLOW_SIMULATED_PAYMENTS"];
  if (envAllowSim)
    merged.allowSimulatedPayments = parseEnvBoolean(
      "OCN_NODE_ALLOW_SIMULATED_PAYMENTS",
      envAllowSim,
    );
  for (const name of COMPONENT_NAMES) {
    const varName = `OCN_NODE_${name.toUpperCase()}_ENABLED`;
    const raw = env[varName];
    if (raw) merged.components[name].enabled = parseEnvBoolean(varName, raw);
  }

  // A wildcard origin is refused outside development, whether it came from the file or the environment.
  if (merged.environment !== "development" && merged.corsOrigins.includes("*")) {
    throw new ConfigError(
      "a wildcard CORS origin (*) is allowed only when the environment is development (OCN_NODE_ENVIRONMENT)",
    );
  }

  const enabled = Object.fromEntries(
    COMPONENT_NAMES.map((n) => [n, merged.components[n].enabled]),
  ) as Record<ComponentName, boolean>;
  const secrets = resolveSecrets(env, enabled, options.readSecretFile, merged.paymentsAdapter);

  // Simulated payments are a stand-in for Stitch. A production Node runs them only when told to (review item 1).
  if (
    merged.components.payments.enabled &&
    merged.paymentsAdapter === "simulated" &&
    merged.environment === "production" &&
    !merged.allowSimulatedPayments
  ) {
    throw new ConfigError(
      "payments are SIMULATED and this Node runs in production (OCN_NODE_ENVIRONMENT): refused to start. " +
        "Set OCN_NODE_ALLOW_SIMULATED_PAYMENTS=true only on a test Node, or switch payments off.",
    );
  }

  return { config: merged, secrets, configFile };
}
