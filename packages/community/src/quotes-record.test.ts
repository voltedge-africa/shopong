import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import { createMemoryRecordNetwork } from "@shopong/adapters-memory";
import { createEvent, webCryptoSha512, type EventEnvelope } from "@shopong/events";
import type { Space, SharedRecord } from "@shopong/ports";
import { describe, expect, it } from "vite-plus/test";
import {
  QUOTE_MESSAGES,
  createCommunity,
  quoteKey,
  type Community,
  type CommunityDeps,
} from "./index.js";
import { toHex } from "./space.js";

const T0 = 1_793_000_000_000;

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

async function phone() {
  const auth = new IsoUcanCapabilityAuth();
  const did = await auth.createIdentity();
  const deps: CommunityDeps = { auth, sha512: webCryptoSha512, randomBytes };
  return { auth, did, deps };
}

const groceries = {
  supplier: "Mama Thandi Wholesale",
  order: "March groceries",
  lines: [{ item: "Sugar", unit: "kg", packSize: 10, pricePerPackCents: 12500 }],
  delivery: { feeCents: 5000, days: 2 },
};

/** A treasurer's community on one in-memory record. `blocked` makes every append fail, as a phone not admitted would. */
async function world(): Promise<{
  treasurer: Awaited<ReturnType<typeof phone>>;
  community: Community;
  block: (on: boolean) => void;
}> {
  const network = createMemoryRecordNetwork();
  const treasurer = await phone();
  let blocked = false;
  const real = network.peer<EventEnvelope>(treasurer.did);
  const record: SharedRecord<EventEnvelope> = {
    local: real.local,
    open: (key, definition) => real.open(key, definition),
    create: async (definition) => {
      const space = await real.create(definition);
      const gatedAppend: Space<EventEnvelope>["append"] = (event) =>
        blocked
          ? Promise.resolve({
              ok: false as const,
              error: {
                code: "not_writable",
                message: `${treasurer.did} is not an admitted writer.`,
              },
            })
          : space.append(event);
      const gated = new Proxy(space, {
        get: (target, key) => {
          if (key === "append") return gatedAppend;
          const value: unknown = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      return gated;
    },
  };
  const made = await createCommunity(treasurer.deps, record, "Ntombi Stokvel", T0);
  if (!made.ok) throw new Error(made.error.message);
  return {
    treasurer,
    community: made.value,
    block: (on) => {
      blocked = on;
    },
  };
}

describe("a refused write shows a plain sentence (finding 7)", () => {
  it("never shows the raw port message, or a DID, when the phone is not admitted", async () => {
    const w = await world();
    w.block(true);
    const result = await w.community.addQuote(groceries, T0 + 10);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("refused");
    expect(result.error.message).toBe("Your phone is not set up to write to this community yet.");
    expect(JSON.stringify(result)).not.toContain("did:");
  });
});

describe("names are tidied before they are keyed (finding 6)", () => {
  it("stores 'Thandi  Wholesale' as the supplier 'Thandi Wholesale', and finds it under a spaced order", async () => {
    const w = await world();
    const added = await w.community.addQuote(
      { ...groceries, supplier: "Thandi  Wholesale" },
      T0 + 10,
    );
    expect(added.ok).toBe(true);
    const found = await w.community.quotesFor("March  groceries");
    expect(found.map((q) => q.supplier)).toEqual(["Thandi Wholesale"]);
    expect(found.map((q) => q.order)).toEqual(["March groceries"]);
  });
});

describe("apply checks the shape of every quote, not only the form (gap)", () => {
  const malformed: [string, Record<string, unknown>][] = [
    [
      "a negative price",
      { ...groceries, lines: [{ ...groceries.lines[0], pricePerPackCents: -5 }] },
    ],
    [
      "a price sent as text",
      { ...groceries, lines: [{ ...groceries.lines[0], pricePerPackCents: "149.90" }] },
    ],
    [
      "no items at all",
      { supplier: groceries.supplier, order: groceries.order, delivery: groceries.delivery },
    ],
  ];

  it.each(malformed)(
    "does not apply a quote with %s written straight to the record",
    async (_, payload) => {
      const w = await world();
      const event = createEvent({
        type: "quote.added",
        space: w.community.key,
        actor: w.treasurer.did,
        proof: [],
        claimedAt: T0 + 10,
        nonce: toHex(randomBytes(16)),
        payload,
      } as never) as EventEnvelope;
      const receipt = await w.community.space.append(event);
      if (!receipt.ok) throw new Error(receipt.error.message);
      await w.community.space.update();

      const stored = await w.community.space.view.get(
        quoteKey(String(payload.order), String(payload.supplier)),
      );
      expect(stored).toBeUndefined();
      const rejected = await w.community.space.view.get(`rejected/${receipt.value.id}`);
      expect(rejected).toMatchObject({ type: "quote.added" });
    },
  );

  it("cannot even be written when a price is fractional: the canonical envelope refuses floats", () => {
    expect(() =>
      createEvent({
        type: "quote.added",
        space: "ab".repeat(32),
        actor: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
        proof: [],
        claimedAt: T0,
        nonce: "00".repeat(16),
        payload: { ...groceries, lines: [{ ...groceries.lines[0], pricePerPackCents: 149.9 }] },
      } as never),
    ).toThrow();
  });

  it("refuses an incomplete payload with the plain sentence that names what is missing", async () => {
    const w = await world();
    const event = createEvent({
      type: "quote.added",
      space: w.community.key,
      actor: w.treasurer.did,
      proof: [],
      claimedAt: T0 + 10,
      nonce: toHex(randomBytes(16)),
      payload: {
        supplier: groceries.supplier,
        order: groceries.order,
        delivery: groceries.delivery,
      },
    } as never) as EventEnvelope;
    const receipt = await w.community.space.append(event);
    if (!receipt.ok) throw new Error(receipt.error.message);
    await w.community.space.update();
    expect(await w.community.space.view.get(`rejected/${receipt.value.id}`)).toEqual({
      type: "quote.added",
      reason: QUOTE_MESSAGES.no_lines,
    });
  });
});
