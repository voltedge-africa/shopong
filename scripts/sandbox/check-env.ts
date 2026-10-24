/**
 * Reports which sandbox credentials are present, without ever printing a value.
 *
 *   node scripts/sandbox/check-env.ts           report only, always exits 0
 *   node scripts/sandbox/check-env.ts --strict  exit 1 if a required item is missing
 *
 * Reads process.env, plus `.env` in the repo root when it exists (process.env wins).
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export interface Check {
  name: string;
  service: string;
  /** `file`: the variable holds a path, and the file must exist. */
  kind: "value" | "file";
  hint: string;
}

export const CHECKS: Check[] = [
  {
    name: "STITCH_CLIENT_ID",
    service: "Stitch",
    kind: "value",
    hint: "docs/sandbox-setup.md#1-stitch",
  },
  {
    name: "STITCH_CLIENT_SECRET",
    service: "Stitch",
    kind: "value",
    hint: "docs/sandbox-setup.md#1-stitch",
  },
  {
    name: "LEDFRA_API_TOKEN",
    service: "Ledfra",
    kind: "value",
    hint: "docs/sandbox-setup.md#2-ledfra",
  },
  {
    name: "LEDFRA_LEDGER_ID",
    service: "Ledfra",
    kind: "value",
    hint: "docs/sandbox-setup.md#2-ledfra",
  },
  {
    name: "SOLANA_DEVNET_KEYPAIR_PATH",
    service: "Solana devnet",
    kind: "file",
    hint: "docs/sandbox-setup.md#3-solana-devnet-wallet",
  },
  {
    name: "EVM_TESTNET_PRIVATE_KEY_PATH",
    service: "EVM testnet",
    kind: "file",
    hint: "docs/sandbox-setup.md#4-evm-testnet-wallet",
  },
];

export type Status = "present" | "missing" | "file-missing";

export interface Result extends Check {
  status: Status;
}

export function evaluate(
  env: Record<string, string | undefined>,
  fileExists: (path: string) => boolean = existsSync,
): Result[] {
  return CHECKS.map((check) => {
    const value = env[check.name];
    let status: Status = "present";
    if (value === undefined || value.trim() === "") status = "missing";
    else if (check.kind === "file" && !fileExists(value.trim())) status = "file-missing";
    return { ...check, status };
  });
}

/** Minimal dotenv: KEY=VALUE lines, optional quotes, `#` comments. Does not expand variables. */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || m[1] === undefined || m[2] === undefined) continue;
    out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

export function render(results: Result[]): string {
  const label: Record<Status, string> = {
    present: "present     ",
    missing: "MISSING     ",
    "file-missing": "FILE MISSING",
  };
  const lines = results.map(
    (r) =>
      `  ${label[r.status]} ${r.name.padEnd(30)} ${r.service}${r.status === "present" ? "" : `  (${r.hint})`}`,
  );
  const bad = results.filter((r) => r.status !== "present").length;
  return [
    ...lines,
    "",
    bad === 0
      ? "All sandbox credentials are present."
      : `${bad} of ${results.length} sandbox items need attention.`,
  ].join("\n");
}

function main(): void {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const dotenvPath = join(root, ".env");
  const fromFile = existsSync(dotenvPath) ? parseDotenv(readFileSync(dotenvPath, "utf8")) : {};
  const results = evaluate({ ...fromFile, ...process.env });
  console.log(
    `Sandbox credentials (.env ${existsSync(dotenvPath) ? "found" : "not found"}; values are never printed):\n`,
  );
  console.log(render(results));
  if (process.argv.includes("--strict") && results.some((r) => r.status !== "present"))
    process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
