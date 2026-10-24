// Runs the golden vectors of @shopong/events (made by an independent Python implementation)
// through a SHA-512 function. The app's /vectors screen runs it with the expo-crypto adapter,
// so the same file is checked in the app's own JavaScript runtime and not only in Node.
// It covers items 1 to 3 of ADR 0001's "What Hermes / React Native must verify"; the HMAC
// commitments (item 4) wait for story 2.7's HMAC adapter.

import golden from "@shopong/events/vectors/golden.json";
import {
  CanonicalizationError,
  canonicalBytes,
  canonicalize,
  decodeEvent,
  encodeEvent,
  encodeUtf8,
  eventIdOf,
  parseEvent,
  sha512Hex,
  type Sha512,
} from "@shopong/events";

export interface VectorFailure {
  readonly group: string;
  readonly name: string;
  readonly detail: string;
}

export interface VectorReport {
  readonly total: number;
  readonly passed: number;
  readonly failures: readonly VectorFailure[];
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export async function runGoldenVectors(sha512: Sha512): Promise<VectorReport> {
  const failures: VectorFailure[] = [];
  let total = 0;
  const check = async (
    group: string,
    name: string,
    test: () => Promise<string | undefined> | string | undefined,
  ) => {
    total++;
    try {
      const problem = await test();
      if (problem !== undefined) failures.push({ group, name, detail: problem });
    } catch (error) {
      failures.push({
        group,
        name,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const expectEqual = (what: string, got: string, want: string): string | undefined =>
    got === want ? undefined : `${what}: got ${got.slice(0, 60)}, want ${want.slice(0, 60)}`;

  for (const v of golden.canonical.accept) {
    await check("canonical.accept", v.name, async () => {
      const value: unknown = JSON.parse(v.input);
      return (
        expectEqual("canonical text", canonicalize(value), v.canonical) ??
        expectEqual("sha512", await sha512Hex(canonicalBytes(value), sha512), v.sha512)
      );
    });
  }
  for (const v of golden.canonical.reject) {
    await check("canonical.reject", v.name, () => {
      try {
        canonicalize(JSON.parse(v.input));
      } catch (error) {
        return error instanceof CanonicalizationError ? undefined : `threw ${String(error)}`;
      }
      return "was accepted";
    });
  }
  for (const v of golden.events.accept) {
    await check("events.accept", v.name, async () => {
      const value: unknown = JSON.parse(v.input);
      const parsed = parseEvent(value);
      if (!parsed.ok) return "did not parse";
      const wire = encodeUtf8(v.canonical);
      const decoded = decodeEvent(wire);
      if (!decoded.ok) return "did not decode";
      const again = encodeEvent(decoded.event);
      return (
        expectEqual("status", parsed.known ? "known" : "opaque", v.status) ??
        expectEqual("event id", await eventIdOf(value, sha512), v.eventId) ??
        expectEqual("wire id", await sha512Hex(wire, sha512), v.eventId) ??
        expectEqual("round trip", Array.from(again).join(","), Array.from(wire).join(","))
      );
    });
  }
  for (const v of golden.events.reject) {
    await check("events.reject", v.name, () =>
      parseEvent(JSON.parse(v.input)).ok ? "was accepted" : undefined,
    );
  }
  for (const v of golden.events.decodeReject) {
    await check("events.decodeReject", v.name, () =>
      decodeEvent(hexToBytes(v.wireHex)).ok ? "was accepted" : undefined,
    );
  }
  return { total, passed: total - failures.length, failures };
}
