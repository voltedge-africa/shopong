// Entry point: `node src/main.ts [--config <path>]`.
// Exits 1, naming the problem, if configuration or a required secret is wrong.

import { parseArgs } from "node:util";
import { writeSync } from "node:fs";
import { writeFatal } from "./logger.ts";
import { ConfigError } from "./secrets.ts";
import { startNode } from "./node.ts";

const stderr = { write: (line: string) => void writeSync(2, line) };

const { values } = parseArgs({ options: { config: { type: "string" } }, strict: true });

try {
  const node = await startNode({ env: process.env, configPath: values.config });

  const shutdown = (signal: string) => {
    node.app.log.info({ signal }, "ocn node shutting down");
    node.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
} catch (error) {
  if (error instanceof ConfigError) {
    writeFatal(stderr, `ocn node refused to start: ${error.message}`, { keys: error.keys });
  } else {
    // Only the error's name and code: the message of an unexpected error could carry anything.
    const code = (error as { code?: unknown } | null)?.code;
    writeFatal(stderr, "ocn node failed to start", {
      error: error instanceof Error ? error.name : "unknown",
      code: typeof code === "string" ? code : undefined,
    });
  }
  process.exit(1);
}
