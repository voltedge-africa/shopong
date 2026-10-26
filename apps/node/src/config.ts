// Typed configuration: defaults, then an optional JSON config file, then
// environment variables. Secrets are not part of this: a config file that
// contains a secret key is refused, and secrets come only from the environment
// (see secrets.ts).

import { readFileSync } from "node:fs";
import { z } from "zod";
import { COMPONENT_NAMES, type ComponentName } from "./components.ts";
import { ConfigError, resolveSecrets, SECRET_KEYS, type ResolvedSecrets } from "./secrets.ts";
import { looksLikeSecretKey } from "./redact.ts";

export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

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
const componentFileSchema = z.strictObject({ enabled: z.boolean().optional() });

const fileSchema = z.strictObject({
  dataDir: z.string().min(1).optional(),
  server: z.strictObject({ host: hostSchema.optional(), port: portSchema.optional() }).optional(),
  logLevel: logLevelSchema.optional(),
  components: z
    .strictObject({
      record: componentFileSchema.optional(),
      ledger: componentFileSchema.optional(),
      payments: componentFileSchema.optional(),
      queue: componentFileSchema.optional(),
    })
    .optional(),
});

export interface NodeConfig {
  /** The Node's data folder. Everything the Node stores on disk goes under it. */
  dataDir: string;
  server: { host: string; port: number };
  logLevel: (typeof LOG_LEVELS)[number];
  components: Record<ComponentName, { enabled: boolean }>;
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
  for (const name of COMPONENT_NAMES) {
    const varName = `OCN_NODE_${name.toUpperCase()}_ENABLED`;
    const raw = env[varName];
    if (raw) merged.components[name].enabled = parseEnvBoolean(varName, raw);
  }

  const enabled = Object.fromEntries(
    COMPONENT_NAMES.map((n) => [n, merged.components[n].enabled]),
  ) as Record<ComponentName, boolean>;
  const secrets = resolveSecrets(env, enabled, options.readSecretFile);

  return { config: merged, secrets, configFile };
}
