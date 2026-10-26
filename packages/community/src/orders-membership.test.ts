// Membership is checked by `apply` before a proposed order is stored (story 8.2). A person who never joined, and a person
// who was removed, each propose through `apply` directly: nothing is stored, and the record says why in plain words.
// Their appends are refused at the record in practice, so the check is reached by calling `apply` with the entry.
import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import { createEvent, type EventEnvelope, type EventId } from "@shopong/events";
import type { ApplyHost, Did, RecordEntry, ViewWriter } from "@shopong/ports";
import { describe, expect, it } from "vite-plus/test";
import { createCommunityApply } from "./apply.js";
import { ORDER_MESSAGES, orderIdKey, orderKey } from "./orders.js";
import { toHex } from "./space.js";

const T0 = 1_793_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const SPACE = "ab".repeat(32);
const CREATOR = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK" as Did;
const STRANGER = "did:key:z6MkmtmqQWNzwamfa7QWkNU3Sk2qHpuXK4VrfMXXqVouVZtL" as Did;
const REMOVED = "did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH" as Did;

const proposal = {
  name: "April groceries",
  items: [{ item: "Cooking oil", quantity: 12 }],
  budgetPerMemberMinor: 50_000,
  deadline: T0 + 7 * DAY_MS,
};

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** Runs `apply` on one `order.proposed` written by `actor` (its own writer), over a plain view seeded with `seed`. */
async function applyProposal(actor: Did, seed: Record<string, unknown>) {
  const auth = new IsoUcanCapabilityAuth();
  const data = new Map<string, unknown>(Object.entries({ "log/time": T0, ...seed }));
  const view: ViewWriter = {
    get: async (key) => data.get(key) as never,
    list: async (prefix) =>
      [...data.keys()]
        .sort()
        .filter((k) => k.startsWith(prefix))
        .map((key) => ({ key, value: data.get(key) as never })),
    put: async (key, value) => {
      data.set(key, value as never);
    },
    del: async (key) => {
      data.delete(key);
    },
  };
  const host: ApplyHost = {
    addWriter: async () => {},
    removeWriter: async () => {},
  };
  const event = createEvent({
    type: "order.proposed",
    space: SPACE,
    actor,
    proof: [],
    claimedAt: T0 + 1,
    nonce: toHex(randomBytes(16)),
    payload: proposal,
  } as never) as EventEnvelope;
  const id = `id-${toHex(randomBytes(4))}` as EventId;
  const entries: RecordEntry<EventEnvelope>[] = [{ id, writer: actor, event }];
  const apply = createCommunityApply({ auth, creator: CREATOR, spaceKey: SPACE });
  await apply(entries, view, host);
  return {
    id,
    data,
    rejected: data.get(`rejected/${id}`) as { type: string; reason: string } | undefined,
  };
}

describe("a proposed order is stored only for a member", () => {
  it("refuses a proposal from a person who never joined: nothing stored, the plain reason recorded", async () => {
    const result = await applyProposal(STRANGER, {
      [`members/${CREATOR}`]: {},
      [`indexers/${CREATOR}`]: true,
    });
    expect(result.rejected).toEqual({
      type: "order.proposed",
      reason: ORDER_MESSAGES.not_member,
    });
    expect(result.data.has(orderKey("April groceries"))).toBe(false);
    expect(result.data.has(orderIdKey(result.id))).toBe(false);
  });

  it("refuses a proposal from a removed member: nothing stored, the plain reason recorded", async () => {
    const result = await applyProposal(REMOVED, {
      [`members/${CREATOR}`]: {},
      [`indexers/${CREATOR}`]: true,
      [`removed/${REMOVED}`]: { by: CREATOR, at: T0 },
    });
    expect(result.rejected).toEqual({
      type: "order.proposed",
      reason: ORDER_MESSAGES.not_member,
    });
    expect(result.data.has(orderKey("April groceries"))).toBe(false);
    expect(result.data.has(orderIdKey(result.id))).toBe(false);
  });

  it("the plain sentence is the one the screen shows", () => {
    expect(ORDER_MESSAGES.not_member).toBe("Only a member can propose an order.");
  });
});
