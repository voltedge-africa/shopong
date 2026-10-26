// The personal-data rule in `apply` (AGENTS.md rule 6): a record event that carries a raw phone number or
// ID number is refused with the plain reason, the refusal is recorded as `rejected/<id>`, and every event
// the community itself writes holds no raw personal value.
import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import { createMemoryRecordNetwork } from "@shopong/adapters-memory";
import {
  PERSONAL_DATA_MESSAGE,
  checkPersonalFields,
  createEvent,
  webCryptoSha512,
  type EventEnvelope,
  type JsonObject,
} from "@shopong/events";
import type { Space, SharedRecord } from "@shopong/ports";
import { describe, expect, it } from "vite-plus/test";
import golden from "@shopong/events/vectors/golden.json" with { type: "json" };
import {
  DAY_MS,
  QUOTE_MESSAGES,
  checkInvitation,
  communityDefinition,
  createCommunity,
  joinCommunity,
  type Community,
  type CommunityDeps,
} from "./index.js";
import { appendChecked } from "./community.js";
import { toHex } from "./space.js";

const T0 = 1_793_000_000_000;
const commitment = golden.commitments[0]?.commitment ?? "";

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** A treasurer's community on one in-memory record. Every event the community appends is kept in `written`. */
async function world() {
  const auth = new IsoUcanCapabilityAuth();
  const did = await auth.createIdentity();
  const deps: CommunityDeps = { auth, sha512: webCryptoSha512, randomBytes };
  const network = createMemoryRecordNetwork();
  const written: EventEnvelope[] = [];
  const real = network.peer<EventEnvelope>(did);
  // The space as the network knows it: replication needs this one, not the spied proxy.
  let rawSpace: Space<EventEnvelope> | undefined;
  const record: SharedRecord<EventEnvelope> = {
    local: real.local,
    open: (key, definition) => real.open(key, definition),
    create: async (definition) => {
      const space = await real.create(definition);
      rawSpace = space;
      const spied = new Proxy(space, {
        get: (target, key) => {
          if (key === "append") {
            return (event: EventEnvelope) => {
              written.push(event);
              return target.append(event);
            };
          }
          const value: unknown = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as Space<EventEnvelope>;
      return spied;
    },
  };
  const made = await createCommunity(deps, record, "Ntombi Stokvel", T0);
  if (!made.ok) throw new Error(made.error.message);
  if (rawSpace === undefined) throw new Error("no space created");
  return { auth, did, deps, network, community: made.value, written, rawSpace };
}

/** A second person, invited and joined, so a role can be given to them (a role goes only to a member). */
async function joinedMember(w: Awaited<ReturnType<typeof world>>) {
  const auth = new IsoUcanCapabilityAuth();
  const did = await auth.createIdentity();
  const deps: CommunityDeps = { auth, sha512: webCryptoSha512, randomBytes };
  const invited = await w.community.invite(did, T0 + 1);
  if (!invited.ok) throw new Error(invited.error.message);
  const space = await w.network
    .peer<EventEnvelope>(did)
    .open(w.community.space.key, communityDefinition(deps, w.did, w.community.key));
  await w.network.replicate<EventEnvelope>(w.rawSpace, space);
  const checked = await checkInvitation({
    auth,
    text: invited.value.code,
    me: did,
    now: T0 + DAY_MS,
  });
  if (!checked.ok) throw new Error(checked.error.message);
  const joined = await joinCommunity(deps, space, checked.value, T0 + DAY_MS);
  if (!joined.ok) throw new Error(joined.error.message);
  await w.network.replicate<EventEnvelope>(w.rawSpace, joined.value.space);
  return did;
}

/** Appends a raw event the way a writer would, then reads what `apply` recorded for it. */
async function appendRaw(
  community: Community,
  type: EventEnvelope["type"],
  payload: JsonObject,
): Promise<{ id: string; rejected: { type: string; reason: string } | undefined }> {
  const event = createEvent({
    type,
    space: community.key,
    actor: community.me,
    proof: [],
    claimedAt: T0 + 1,
    nonce: toHex(randomBytes(16)),
    payload,
  } as never) as EventEnvelope;
  const receipt = await community.space.append(event);
  if (!receipt.ok) throw new Error(receipt.error.message);
  await community.space.update();
  const rejected = await community.space.view.get(`rejected/${receipt.value.id}`);
  return {
    id: receipt.value.id,
    rejected: rejected as { type: string; reason: string } | undefined,
  };
}

describe("apply refuses raw personal values (matrix: raw phone in a field)", () => {
  it("refuses a raw phone number in a field, with the plain reason, and records the refusal", async () => {
    const w = await world();
    const result = await appendRaw(w.community, "order.proposed", { phone: "082 123 4567" });
    expect(result.rejected).toEqual({ type: "order.proposed", reason: PERSONAL_DATA_MESSAGE });
    expect(PERSONAL_DATA_MESSAGE).toBe("Personal details can't be written to the shared record.");
  });

  it("refuses phone-shaped free text in an event of any type", async () => {
    const w = await world();
    const result = await appendRaw(w.community, "order.proposed", { title: "Call 0821234567" });
    expect(result.rejected?.reason).toBe(PERSONAL_DATA_MESSAGE);
  });

  it("accepts a commitment in a personal field", async () => {
    const w = await world();
    const result = await appendRaw(w.community, "order.proposed", { phone: commitment });
    expect(result.rejected).toBeUndefined();
  });

  it("keeps the quote's own message for a phone-shaped item name (matrix: phone-shaped free text)", async () => {
    const w = await world();
    const result = await appendRaw(w.community, "quote.added", {
      supplier: "Mama Thandi Wholesale",
      order: "March groceries",
      lines: [{ item: "Sugar 0821234567", unit: "kg", packSize: 10, pricePerPackCents: 12500 }],
      delivery: { feeCents: 5000, days: 2 },
    });
    expect(result.rejected?.reason).toBe(`Line 1: ${QUOTE_MESSAGES.item_phone}`);
    expect(result.rejected?.reason).not.toBe(PERSONAL_DATA_MESSAGE);
  });
});

describe("every event the community writes is free of raw personal values", () => {
  it("holds for the events of creating, inviting, granting a role and adding a quote", async () => {
    const w = await world();
    const invited = await w.community.invite(
      await new IsoUcanCapabilityAuth().createIdentity(),
      T0 + 1,
    );
    expect(invited.ok, JSON.stringify(invited)).toBe(true);
    const driver = await joinedMember(w);
    const granted = await w.community.grantRole(driver, "driver", { days: 7 }, T0 + 2);
    expect(granted.ok, JSON.stringify(granted)).toBe(true);
    const quoted = await w.community.addQuote(
      {
        supplier: "Mama Thandi Wholesale",
        order: "March groceries",
        lines: [{ item: "Sugar", unit: "kg", packSize: 10, pricePerPackCents: 12500 }],
        delivery: { feeCents: 5000, days: 2 },
      },
      T0 + 3,
    );
    expect(quoted.ok, JSON.stringify(quoted)).toBe(true);
    expect(w.written.length).toBeGreaterThanOrEqual(3);
    for (const event of w.written) {
      expect(checkPersonalFields(event.payload), event.type).toEqual([]);
    }
  });
});

describe("appending is checked before anything is written (review H1)", () => {
  it("refuses an event that holds a phone number, appends nothing, and says why", async () => {
    const w = await world();
    const appendsBefore = w.written.length;
    const event = createEvent({
      type: "order.proposed",
      space: w.community.key,
      actor: w.community.me,
      proof: [],
      claimedAt: T0 + 1,
      nonce: toHex(randomBytes(16)),
      payload: { title: "Groceries", contact: "082 123 4567" },
    } as never) as EventEnvelope;
    const result = await appendChecked(w.community.space, event);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("personal_data");
      expect(result.error.message).toBe(PERSONAL_DATA_MESSAGE);
    }
    // Nothing reached the log: the space's append was never called.
    expect(w.written.length).toBe(appendsBefore);
  });

  it("refuses an event with a raw phone number in a quote's extra key through the quote path too", async () => {
    const w = await world();
    const quoted = await w.community.addQuote(
      {
        supplier: "Mama Thandi Wholesale",
        order: "March groceries",
        lines: [{ item: "Sugar", unit: "kg", packSize: 10, pricePerPackCents: 12500 }],
        delivery: { feeCents: 5000, days: 2 },
        note: "0821234567",
      },
      T0 + 3,
    );
    expect(quoted.ok).toBe(false);
    if (!quoted.ok) expect(quoted.error.message).toBe(QUOTE_MESSAGES.unknown_field);
  });
});

describe("apply's second line for quotes (review H2)", () => {
  it("records a quote's extra key with the quote's own sentence, not the personal-data one", async () => {
    const w = await world();
    const result = await appendRaw(w.community, "quote.added", {
      supplier: "Mama Thandi Wholesale",
      order: "Batch 082 123 4567",
      lines: [{ item: "Sugar", unit: "kg", packSize: 10, pricePerPackCents: 12500 }],
      delivery: { feeCents: 5000, days: 2 },
    });
    expect(result.rejected, "the quote must be refused").toBeDefined();
    expect(result.rejected?.reason).toBe(QUOTE_MESSAGES.order_phone);
  });
});
