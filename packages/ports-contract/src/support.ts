import { describe, expect, it } from "vite-plus/test";
import type { EventId, PortError, Result } from "@shopong/ports";

/** Builds what a contract needs. Called once per test so every test starts fresh. */
export type Factory<H> = () => H | Promise<H>;

/** One behaviour every adapter of a port must show. */
export interface ContractCase<H> {
  readonly name: string;
  readonly run: (harness: H) => Promise<void>;
}

export interface ContractOptions {
  /** Per-test timeout; raise it for real services. */
  readonly timeoutMs?: number;
}

/** Register a contract's cases as `vite-plus/test` tests inside a `describe` block. */
export function registerContract<H>(
  suite: string,
  cases: readonly ContractCase<H>[],
  factory: Factory<H>,
  options: ContractOptions = {},
): void {
  describe(suite, () => {
    for (const contractCase of cases) {
      it(contractCase.name, async () => contractCase.run(await factory()), options.timeoutMs);
    }
  });
}

/** Unwrap a successful result or fail with the error. */
export function expectOk<T, E extends PortError>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}

/** Assert a failed result with one of the given codes. */
export function expectErr<T, E extends PortError>(result: Result<T, E>, ...codes: E["code"][]): E {
  if (result.ok) throw new Error(`expected error ${codes.join(" | ")}, got ok`);
  expect(codes).toContain(result.error.code);
  return result.error;
}

/**
 * A string unique to this test run. Real services keep state between runs (a sandbox
 * ledger, a test payment client), so names and keys must never repeat.
 */
export function unique(prefix = "c"): string {
  return `${prefix}${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/** A random, well-formed event id (128 lowercase hex chars), unique to this run. */
export function randomEventId(): EventId {
  let hex = "";
  while (hex.length < 128) hex += globalThis.crypto.randomUUID().replace(/-/g, "");
  return hex.slice(0, 128) as EventId;
}

/** A deterministic, NON-CRYPTOGRAPHIC 128-hex id for test events, so replays can be compared. */
export function testEventId(value: unknown): EventId {
  const input = JSON.stringify(value);
  let hex = "";
  for (let seed = 1; hex.length < 128; seed++) {
    let h = 0x811c9dc5 ^ seed;
    for (let i = 0; i < input.length; i++) h = Math.imul(h ^ input.charCodeAt(i), 0x01000193);
    hex += (h >>> 0).toString(16).padStart(8, "0");
  }
  return hex as EventId;
}

/**
 * Poll until `probe` returns a value, for effects a real service applies asynchronously
 * (a chain confirmation). Never assume they are immediate.
 */
export async function eventually<T>(
  probe: () => Promise<T | undefined>,
  { timeoutMs = 10_000, intervalMs = 50 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`condition not met within ${String(timeoutMs)} ms`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
