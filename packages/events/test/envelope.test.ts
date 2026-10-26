import { describe, expect, it } from "vite-plus/test";
import {
  ENVELOPE_VERSION,
  EVENT_TYPES,
  InvalidEventError,
  createEvent,
  decodeEvent,
  encodeEvent,
  encodeUtf8,
  eventIdOf,
  isEventId,
  isEventType,
  parseEvent,
  sha512Hex,
  webCryptoSha512,
  type ParseResult,
} from "../src/index.js";
import { hexToBytes, vectors } from "./vectors.js";

describe("event vectors: accepted envelopes", () => {
  for (const v of vectors.events.accept) {
    it(v.name, async () => {
      const result = parseEvent(JSON.parse(v.input));
      if (!result.ok) throw new Error(JSON.stringify(result.issues));
      expect(result.known ? "known" : "opaque").toBe(v.status);
      if (!result.known) expect(result.reason).toBe(v.reason);
      expect(await eventIdOf(result.event, webCryptoSha512)).toBe(v.eventId);
    });
  }
});

describe("event vectors: rejected envelopes", () => {
  for (const v of vectors.events.reject) {
    it(v.name, () => {
      const result = parseEvent(JSON.parse(v.input));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues.length).toBeGreaterThan(0);
    });
  }
});

describe("decodeEvent: the wire form is the canonical form", () => {
  for (const v of vectors.events.accept) {
    it(`round-trips ${v.name} byte for byte with the same id`, async () => {
      const wire = encodeUtf8(v.canonical);
      const result = decodeEvent(wire);
      if (!result.ok) throw new Error(JSON.stringify(result.issues));
      const again = encodeEvent(result.event);
      expect(again).toEqual(wire);
      expect(await eventIdOf(result.event, webCryptoSha512)).toBe(v.eventId);
      expect(await sha512Hex(wire, webCryptoSha512)).toBe(v.eventId);
    });
  }

  for (const v of vectors.events.decodeReject) {
    it(`rejects ${v.name}`, () => {
      expect(decodeEvent(hexToBytes(v.wireHex)).ok).toBe(false);
    });
  }

  it("rejects bytes that are not JSON", () => {
    expect(decodeEvent(encodeUtf8("{")).ok).toBe(false);
  });
});

describe("forward compatibility", () => {
  const opaque = vectors.events.accept.filter((v) => v.status === "opaque");

  it("covers both an unknown type and a higher version", () => {
    expect(new Set(opaque.map((v) => v.reason))).toEqual(
      new Set(["unknown-type", "future-version"]),
    );
  });

  it("an older reader folds a mixed stream, skipping opaque events without error", () => {
    const stream = vectors.events.accept.map((v) => decodeEvent(encodeUtf8(v.canonical)));
    const view = { orders: 0, ignored: 0 };
    const apply = (r: ParseResult) => {
      if (!r.ok) throw new Error("invalid event");
      if (!r.known) {
        view.ignored++;
        return;
      }
      if (r.event.type === "order.proposed") view.orders++;
    };
    expect(() => stream.forEach(apply)).not.toThrow();
    expect(view).toEqual({ orders: 1, ignored: opaque.length });
  });

  it("keeps extra top-level fields of a future version", () => {
    const v = vectors.events.accept.find((x) => x.name === "future version with extra fields");
    const result = decodeEvent(encodeUtf8(v?.canonical ?? ""));
    expect(result.ok && !result.known && "sig" in result.event && result.event.sig).toBe("AAEC");
  });
});

describe("parseEvent never throws", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const cases: [string, unknown][] = [
    ["undefined", undefined],
    ["null", null],
    ["a number", 1],
    ["a string", "x"],
    ["an array", []],
    ["a Date", new Date(0)],
    ["a cycle", cyclic],
    ["a bigint field", { v: 1n }],
    ["NaN in payload", { payload: { a: Number.NaN } }],
  ];
  for (const [name, value] of cases) {
    it(`returns issues for ${name}`, () => {
      expect(parseEvent(value).ok).toBe(false);
    });
  }
});

describe("createEvent", () => {
  const base = JSON.parse(vectors.events.accept[0]?.input ?? "{}") as Record<string, unknown>;
  const { v: _v, ...fields } = base;

  it("sets the current version and validates", async () => {
    const event = createEvent({
      ...(fields as Parameters<typeof createEvent<"order.proposed">>[0]),
    });
    expect(event.v).toBe(ENVELOPE_VERSION);
    expect(isEventId(await eventIdOf(event, webCryptoSha512))).toBe(true);
  });

  it("throws InvalidEventError with issues for a bad envelope", () => {
    const bad = { ...fields, nonce: "short" } as Parameters<
      typeof createEvent<"order.proposed">
    >[0];
    expect(() => createEvent(bad)).toThrow(InvalidEventError);
  });

  it("refuses unknown types", () => {
    const bad = { ...fields, type: "made.up" } as unknown as Parameters<
      typeof createEvent<"order.proposed">
    >[0];
    expect(() => createEvent(bad)).toThrow("unknown event type");
  });
});

describe("event type registry", () => {
  it("holds the first-release types from architecture.md section 6", () => {
    const families = [
      "member",
      "role",
      "order",
      "quote",
      "pledge",
      "payment",
      "ledger",
      "delivery",
    ];
    const more = ["collection", "funding", "obligation", "solution", "agent"];
    expect(new Set(EVENT_TYPES.map((t) => t.split(".")[0]))).toEqual(
      new Set([...families, ...more]),
    );
    // 28 first-release types, plus `payment.payout` and `payment.approved` (story 4.7).
    expect(EVENT_TYPES).toHaveLength(30);
    expect(new Set(EVENT_TYPES).size).toBe(EVENT_TYPES.length);
  });

  it("isEventType knows registered types only", () => {
    expect(isEventType("payment.completed")).toBe(true);
    expect(isEventType("stokvel.rotation-scheduled")).toBe(false);
    expect(isEventType(42)).toBe(false);
  });
});

describe("eventIdOf", () => {
  it("covers proof: changing the proof changes the id", async () => {
    const event = JSON.parse(vectors.events.accept[0]?.input ?? "{}") as Record<string, unknown>;
    const a = await eventIdOf(event, webCryptoSha512);
    const b = await eventIdOf({ ...event, proof: [] }, webCryptoSha512);
    expect(a).not.toBe(b);
  });

  it("rejects an injected hash of the wrong length", async () => {
    await expect(eventIdOf({}, async () => new Uint8Array(32))).rejects.toThrow("expected 64");
  });
});

describe("issues", () => {
  it("reports a missing field once, by path", () => {
    const event = JSON.parse(vectors.events.accept[0]?.input ?? "{}") as Record<string, unknown>;
    delete event.nonce;
    const result = parseEvent(event);
    expect(result.ok ? [] : result.issues).toEqual([
      { path: "$.nonce", message: "required field is missing" },
    ]);
  });
});

describe("member.invited and member.joined payloads", () => {
  const base = {
    space: "ab".repeat(32),
    actor: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
    proof: [] as string[],
    claimedAt: 1793001600000,
    nonce: "00".repeat(16),
  };
  const invitee = "did:key:z6MkmtmqQWNzwamfa7QWkNU3Sk2qHpuXK4VrfMXXqVouVZtL";

  it("accepts the strict shapes", () => {
    expect(
      createEvent({
        ...base,
        type: "member.invited",
        payload: { invitation: "bafy", invitee, expiresAt: 5 },
      }).type,
    ).toBe("member.invited");
    expect(
      createEvent({ ...base, type: "member.joined", payload: { invitation: "bafy" } }).type,
    ).toBe("member.joined");
  });

  it.each([
    ["joined without an invitation", "member.joined", {}],
    ["joined with an empty invitation", "member.joined", { invitation: "" }],
    ["joined with a number", "member.joined", { invitation: 7 }],
    ["invited without invitee", "member.invited", { invitation: "x", expiresAt: 5 }],
    [
      "invited with a bad invitee",
      "member.invited",
      { invitation: "x", invitee: "bob", expiresAt: 5 },
    ],
    [
      "invited with a fractional end",
      "member.invited",
      { invitation: "x", invitee, expiresAt: 1.5 },
    ],
    ["invited without an end", "member.invited", { invitation: "x", invitee }],
  ] as const)("rejects %s", (_name, type, payload) => {
    expect(parseEvent({ v: 1, ...base, type, payload }).ok).toBe(false);
  });
});
