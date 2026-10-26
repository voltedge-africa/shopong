// `apply` on `member.area` over a plain in-memory view (story 7.3): the membership guard and the shape guard are each
// tested on their own, so removing either one fails a test. Events are written as plain envelopes, so a malformed
// payload reaches `apply` the way a hostile writer's would.
import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import type { EventEnvelope } from "@shopong/events";
import type { ApplyHost, Did, EventId, RecordEntry, ViewWriter } from "@shopong/ports";
import { describe, expect, it } from "vite-plus/test";
import { createCommunityApply } from "./apply.js";
import { MEMBER_AREA_MESSAGES } from "./areas.js";

const T0 = 1_793_000_000_000;
const CREATOR = `did:key:z6Mk${"c".repeat(44)}` as Did;
const MEMBER = `did:key:z6Mk${"m".repeat(44)}` as Did;
const STRANGER = `did:key:z6Mk${"s".repeat(44)}` as Did;
const SPACE = "ab".repeat(32);
const UNREADABLE = MEMBER_AREA_MESSAGES.unreadable;
const NOT_A_MEMBER = MEMBER_AREA_MESSAGES.not_a_member;

/** Runs `apply` on one `member.area` written by `actor`, over a view seeded with `seed`. */
async function applyArea(actor: Did, payload: unknown, seed: Record<string, unknown>) {
  const auth = new IsoUcanCapabilityAuth();
  const data = new Map<string, unknown>(Object.entries(seed));
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
  const host: ApplyHost = { addWriter: async () => {}, removeWriter: async () => {} };
  const event = {
    v: 1,
    type: "member.area",
    space: SPACE,
    actor,
    proof: [],
    claimedAt: T0,
    nonce: "1".repeat(32),
    payload,
  } as unknown as EventEnvelope;
  const id = "id-area-1" as EventId;
  const entries: RecordEntry<EventEnvelope>[] = [{ id, writer: actor, event }];
  const apply = createCommunityApply({ auth, creator: CREATOR, spaceKey: SPACE });
  await apply(entries, view, host);
  return {
    stored: data.get(`areas/${actor}`),
    rejected: data.get(`rejected/${id}`) as { type: string; reason: string } | undefined,
  };
}

const members = {
  [`members/${CREATOR}`]: { joinedAt: T0 },
  [`members/${MEMBER}`]: { joinedAt: T0 },
};

describe("member.area apply: the membership guard", () => {
  it("stores the area of a member, and nothing else", async () => {
    const result = await applyArea(MEMBER, { area: "Umbilo" }, members);
    expect(result.stored).toEqual({ area: "Umbilo" });
    expect(result.rejected).toBeUndefined();
  });

  it("refuses a person who never joined: nothing stored, the plain reason kept", async () => {
    const result = await applyArea(STRANGER, { area: "Umbilo" }, members);
    expect(result.stored).toBeUndefined();
    expect(result.rejected).toEqual({ type: "member.area", reason: NOT_A_MEMBER });
  });

  it("refuses a removed member: nothing stored, the plain reason kept", async () => {
    // A removal deletes `members/<did>` and keeps `removed/<did>`, so the seed is the record after a removal.
    const removed = {
      [`members/${CREATOR}`]: { joinedAt: T0 },
      [`removed/${MEMBER}`]: { by: CREATOR, at: T0 },
    };
    const result = await applyArea(MEMBER, { area: "Umbilo" }, removed);
    expect(result.stored).toBeUndefined();
    expect(result.rejected).toEqual({ type: "member.area", reason: NOT_A_MEMBER });
  });
});

describe("member.area apply: the shape guard", () => {
  const malformed: [string, unknown][] = [
    ["a street address", { area: "12 Church Street, Umbilo" }],
    ["a street name with no number", { area: "Church Street" }],
    ["an erf number", { area: "Erf 45" }],
    ["a bare digit", { area: "Umbilo 2" }],
    ["an empty area", { area: "   " }],
    ["an area over 60 characters", { area: "x".repeat(61) }],
    ["an extra key beside the area", { area: "Umbilo", street: "Church Street" }],
    ["no area at all", {}],
  ];

  for (const [name, payload] of malformed) {
    it(`refuses ${name} written straight to the record: nothing stored, a rejection kept`, async () => {
      const result = await applyArea(MEMBER, payload, members);
      expect(result.stored).toBeUndefined();
      expect(result.rejected).toBeDefined();
      expect(result.rejected?.type).toBe("member.area");
      expect(result.rejected?.reason).toBeTruthy();
    });
  }

  it("refuses a malformed area with the plain 'can't be read' sentence (not the membership one)", async () => {
    const result = await applyArea(MEMBER, { area: "Erf 45" }, members);
    expect(result.rejected?.reason).toBe(UNREADABLE);
  });
});
