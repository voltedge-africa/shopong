// The phone's proof events (story 7.6): the arrival, a member's own share and a dispute are built as the record expects,
// and the signer is always the phone's own person.
import { describe, expect, it } from "vite-plus/test";
import type { Did } from "@shopong/ports";
import {
  collectionConfirmedEvent,
  deliveryConfirmedEvent,
  deliveryDisputedEvent,
} from "./communityEvents";

const SPACE = "ab".repeat(32);
const ME = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK" as Did;
const PHOTO = "f".repeat(128);
const DELIVERY = "e".repeat(128);
const base = {
  community: SPACE,
  now: 1_793_000_000_000,
  randomBytes: (n: number) => new Uint8Array(n).fill(7),
};

describe("the phone's proof events", () => {
  it("builds the driver's arrival with the photo's SHA-512 and no place", () => {
    const event = deliveryConfirmedEvent({ ...base, me: ME, order: "current", photoSha512: PHOTO });
    expect(event.type).toBe("delivery.confirmed");
    expect(event.actor).toBe(ME);
    expect(event.payload).toEqual({ order: "current", photoSha512: PHOTO });
  });

  it("builds a member's own share, naming the member as the signer", () => {
    const event = collectionConfirmedEvent({
      ...base,
      me: ME,
      order: "current",
      delivery: DELIVERY,
    });
    expect(event.type).toBe("collection.confirmed");
    expect(event.payload).toEqual({ order: "current", delivery: DELIVERY, member: ME });
  });

  it("builds a dispute with the note only when the person wrote one", () => {
    const bare = deliveryDisputedEvent({ ...base, me: ME, order: "current", delivery: DELIVERY });
    expect(bare.payload).toEqual({ order: "current", delivery: DELIVERY });
    const noted = deliveryDisputedEvent({
      ...base,
      me: ME,
      order: "current",
      delivery: DELIVERY,
      note: "2 of 10 bags did not arrive",
    });
    expect(noted.payload).toEqual({
      order: "current",
      delivery: DELIVERY,
      note: "2 of 10 bags did not arrive",
    });
  });
});
