// The phone's naming event (story 8.1): the community's name and rules note, in the one envelope.
import { describe, expect, it } from "vite-plus/test";
import { parseEvent } from "@shopong/events";
import type { Did } from "@shopong/ports";
import { namingEvent } from "./communityEvents";

const ME = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK" as Did;
const COMMUNITY = "ab".repeat(32);
const base = {
  community: COMMUNITY,
  me: ME,
  now: 1_793_000_000_000,
  randomBytes: (n: number) => new Uint8Array(n).fill(7),
};

describe("the naming event", () => {
  it("writes the name and the rules note, with no proof", () => {
    const event = namingEvent({ ...base, name: "Ntombi Stokvel", rules: "Pay in on Fridays." });
    expect(event.type).toBe("community.named");
    expect(event.actor).toBe(ME);
    expect(event.proof).toEqual([]);
    expect(event.payload).toEqual({ name: "Ntombi Stokvel", rules: "Pay in on Fridays." });
  });

  it("is an event the registry accepts in the strict form", () => {
    const event = namingEvent({ ...base, name: "Ntombi Stokvel", rules: "" });
    expect(parseEvent(event).ok).toBe(true);
  });
});
