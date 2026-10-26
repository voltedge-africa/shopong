// Structured JSON logging (pino) with automatic redaction. Fastify uses this
// instance too, so request logs get the same protection.

import { pino, type Logger } from "pino";
import { createScrubber, redactObject } from "./redact.ts";

export interface LogSink {
  write(line: string): void;
}

export interface LoggerOptions {
  level: string;
  /** Resolved secret values; any that appear in output are scrubbed. */
  secretValues?: readonly string[];
  /** Where lines go. Defaults to standard output. */
  sink?: LogSink;
}

export function createLogger(options: LoggerOptions): Logger {
  const scrub = createScrubber(options.secretValues ?? []);
  const sink: LogSink = options.sink ?? { write: (line) => void process.stdout.write(line) };
  // Redaction runs on the finished line, after pino has merged child bindings
  // and serialised errors, so no path (log object, child(), err) can skip it.
  const stream = {
    write: (line: string) => {
      let out = line;
      try {
        out = `${JSON.stringify(redactObject(JSON.parse(line)))}\n`;
      } catch {
        // Not JSON (should not happen): fall through to value scrubbing only.
      }
      sink.write(scrub(out));
    },
  };
  return pino(
    {
      level: options.level,
      base: { service: "ocn-node" },
      // A simulated bank page's address is a capability (review item 1): its id never reaches a log line.
      serializers: {
        req: (req: {
          method?: string;
          url?: string;
          host?: string;
          remoteAddress?: string;
          remotePort?: number;
        }) => ({
          method: req.method,
          url: (req.url ?? "").replace(/^\/simulated-bank\/[^/?]+/u, "/simulated-bank/:id"),
          host: req.host,
          remoteAddress: req.remoteAddress,
          remotePort: req.remotePort,
        }),
      },
    },
    stream,
  );
}

/** Writes one fatal line before a logger exists (startup failures). Always scrubbed and redacted. */
export function writeFatal(
  sink: LogSink,
  message: string,
  fields: Record<string, unknown> = {},
): void {
  sink.write(
    `${JSON.stringify({
      level: "fatal",
      time: Date.now(),
      service: "ocn-node",
      ...(redactObject(fields) as object),
      msg: message,
    })}\n`,
  );
}
