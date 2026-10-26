// The secret registry (architecture rule 4, section 7): which secrets each
// component needs, declared in code. A secret is read only from the process
// environment, either `KEY` or `KEY_FILE` (a path to a file holding the value).
// It is never read from the config file. The registry is the only place that
// knows secret names, so the config loader and the logger share one list.

import { readFileSync } from "node:fs";
import { inspect } from "node:util";
import type { ComponentName } from "./components.ts";

/** A component that owns secrets: one of the four, or one that does not exist yet. */
export type SecretOwner = ComponentName | "stablecoin" | "llm";

/** Which payments adapter the Node runs (`PAYMENTS_ADAPTER`). `stitch` is refused until a real adapter exists. */
export type PaymentsAdapterName = "simulated" | "stitch";

export interface SecretDefinition {
  key: string;
  owner: SecretOwner;
  /** Required only counts while the owner is an enabled component; placeholders are never required. */
  required: boolean;
  description: string;
  /** For a payments secret: only the selected adapter needs it. Undefined: needed by the owner alone. */
  adapter?: PaymentsAdapterName;
}

export const SECRET_DEFINITIONS: readonly SecretDefinition[] = [
  {
    key: "RECORD_MASTER_KEY",
    owner: "record",
    required: true,
    description: "32-byte master key (64 hex characters) for the shared record's keys and storage",
  },
  {
    key: "SIMULATED_WEBHOOK_SECRET",
    owner: "payments",
    required: true,
    adapter: "simulated",
    description:
      "SIMULATED Stitch only (story 4.4): the 32-byte key that signs simulated webhooks, 64 hex characters. Not a Stitch credential; never leaves the Node",
  },
  {
    key: "STITCH_CLIENT_ID",
    owner: "payments",
    required: true,
    adapter: "stitch",
    description: "Stitch client id (pay-in and pay-out); needed once a real Stitch adapter exists",
  },
  {
    key: "STITCH_CLIENT_SECRET",
    owner: "payments",
    required: true,
    adapter: "stitch",
    description: "Stitch client secret; needed once a real Stitch adapter exists",
  },
  {
    key: "COMMUNITY_SECRET",
    owner: "record",
    required: false,
    description:
      "Community secret for personal-data commitments: 32 bytes as 64 hex characters (story 2.7). Never leaves the Node",
  },
  {
    key: "STABLECOIN_SIGNING_KEY",
    owner: "stablecoin",
    required: false,
    description: "Signing key for the stablecoin rail (placeholder until that adapter exists)",
  },
  {
    key: "LLM_API_KEY",
    owner: "llm",
    required: false,
    description: "LLM provider API key (placeholder until the agent runtime exists)",
  },
];

export const SECRET_KEYS: readonly string[] = SECRET_DEFINITIONS.map((d) => d.key);

/** Raised for any unusable configuration. The message names keys and never values. */
export class ConfigError extends Error {
  readonly keys: readonly string[];

  constructor(message: string, keys: readonly string[] = []) {
    super(message);
    this.name = "ConfigError";
    this.keys = keys;
  }
}

/**
 * Resolved secret values. Held privately so that logging, serialising or
 * inspecting this object shows key names only.
 */
export class ResolvedSecrets {
  readonly #values: ReadonlyMap<string, string>;

  constructor(values: ReadonlyMap<string, string>) {
    this.#values = values;
  }

  has(key: string): boolean {
    return this.#values.has(key);
  }

  get(key: string): string | undefined {
    return this.#values.get(key);
  }

  keys(): string[] {
    return [...this.#values.keys()].sort();
  }

  /** Every resolved value, for the logger's last-line scrubbing. */
  values(): string[] {
    return [...this.#values.values()];
  }

  toJSON(): { keys: string[] } {
    return { keys: this.keys() };
  }

  [inspect.custom](): string {
    return `ResolvedSecrets { keys: ${JSON.stringify(this.keys())} }`;
  }
}

export type ReadSecretFile = (path: string) => string;

const defaultReadSecretFile: ReadSecretFile = (path) => readFileSync(path, "utf8");

function clean(value: string): string {
  return value.replace(/\r?\n$/u, "");
}

/**
 * Resolves every secret in the registry from `env` (`KEY` or `KEY_FILE`).
 * Throws a ConfigError naming each missing required key, each key set both
 * ways, and each unreadable secret file (key and OS error code only).
 */
export function resolveSecrets(
  env: Readonly<Record<string, string | undefined>>,
  enabled: Readonly<Record<ComponentName, boolean>>,
  readSecretFile: ReadSecretFile = defaultReadSecretFile,
  paymentsAdapter: PaymentsAdapterName = "simulated",
): ResolvedSecrets {
  const values = new Map<string, string>();
  const missing: string[] = [];
  const problems: string[] = [];
  const problemKeys: string[] = [];

  for (const def of SECRET_DEFINITIONS) {
    const direct = env[def.key];
    const filePath = env[`${def.key}_FILE`];
    let value: string | undefined;

    if (direct !== undefined && direct !== "" && filePath !== undefined && filePath !== "") {
      problems.push(`${def.key} is set both directly and as ${def.key}_FILE; set only one`);
      problemKeys.push(def.key);
      continue;
    }
    if (direct !== undefined && direct !== "") {
      value = direct;
    } else if (filePath !== undefined && filePath !== "") {
      try {
        value = clean(readSecretFile(filePath));
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        problems.push(
          `${def.key}_FILE could not be read (${typeof code === "string" ? code : "UNKNOWN"})`,
        );
        problemKeys.push(def.key);
        continue;
      }
    }

    if (value !== undefined && value !== "") {
      values.set(def.key, value);
    } else if (isRequired(def, enabled, paymentsAdapter)) {
      missing.push(def.key);
    }
  }

  if (missing.length > 0) {
    missing.sort();
    problems.unshift(`missing required secret(s): ${missing.join(", ")}`);
  }
  if (problems.length > 0) {
    throw new ConfigError(problems.join("; "), [...missing, ...problemKeys]);
  }
  return new ResolvedSecrets(values);
}

function isOwnerEnabled(owner: SecretOwner, enabled: Readonly<Record<ComponentName, boolean>>) {
  return owner in enabled && enabled[owner as ComponentName];
}

/** Required now: the owner is enabled, and the secret's adapter (if it has one) is the selected one. */
function isRequired(
  def: SecretDefinition,
  enabled: Readonly<Record<ComponentName, boolean>>,
  paymentsAdapter: PaymentsAdapterName,
): boolean {
  if (!def.required || !isOwnerEnabled(def.owner, enabled)) return false;
  return def.adapter === undefined || def.adapter === paymentsAdapter;
}

/** The required secrets of `component` that were not resolved, for the adapter that is selected. */
export function missingRequiredFor(
  component: ComponentName,
  secrets: ResolvedSecrets,
  paymentsAdapter: PaymentsAdapterName = "simulated",
): string[] {
  return SECRET_DEFINITIONS.filter(
    (d) =>
      d.owner === component &&
      d.required &&
      (d.adapter === undefined || d.adapter === paymentsAdapter) &&
      !secrets.has(d.key),
  ).map((d) => d.key);
}
