// Test-only helpers. Production code injects an audited HMAC (AGENTS rule 6); the tests use Web Crypto.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HmacSha512 } from "@shopong/events";
import type { Clock, EpochMs } from "@shopong/ports";

export const webCryptoHmac: HmacSha512 = async (key, message) => {
  const k = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(key),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, new Uint8Array(message)));
};

/** A clock that only moves when a test moves it. */
export interface ManualClock extends Clock {
  set(time: EpochMs): void;
  advance(ms: number): void;
}

export function manualClock(start: EpochMs = Date.UTC(2026, 9, 26)): ManualClock {
  let time = start;
  return {
    now: () => time,
    set: (next) => {
      time = next;
    },
    advance: (ms) => {
      time += ms;
    },
  };
}

/** A fresh 32-byte webhook key, unique to each call. */
export function randomKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/** A data folder for one test run, removed by `cleanup`. */
export function scratchFolder(): {
  dir: string;
  file: (name: string) => string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "stitch-sim-"));
  return {
    dir,
    file: (name) => join(dir, name),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** Collects log lines so a test can check every one of them. */
export function lineSink(): { lines: string[]; log: (line: string) => void } {
  const lines: string[] = [];
  return { lines, log: (line) => void lines.push(line) };
}
