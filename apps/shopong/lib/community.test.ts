import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import { INVITATION_MESSAGES } from "@shopong/community";
import { describe, expect, it } from "vite-plus/test";

import { createCommunityService } from "./community";

const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

const person = async () => {
  const auth = new IsoUcanCapabilityAuth();
  return { auth, did: await auth.createIdentity() };
};

describe("community service", () => {
  it("makes a community, invites a person, and the invitee's phone checks it offline", async () => {
    const treasurer = await person();
    const newcomer = await person();
    const clock = 1_793_000_000_000;
    const mine = createCommunityService(treasurer, { randomBytes, now: () => clock });
    const made = await mine.create("Ntombi Stokvel");
    expect(made.ok).toBe(true);
    expect((await mine.members()).map((m) => m.did)).toEqual([treasurer.did]);

    const invitation = await mine.invite(newcomer.did);
    if (!invitation.ok) throw new Error(invitation.error.message);
    expect(invitation.value.code).toContain("shopong://join?");

    const theirs = createCommunityService(newcomer, { randomBytes, now: () => clock });
    expect((await theirs.check(invitation.value.code)).ok).toBe(true);
    const elsewhere = createCommunityService(treasurer, { randomBytes, now: () => clock });
    const refused = await elsewhere.check(invitation.value.code);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toBe(INVITATION_MESSAGES.someone_else);
  });

  it("refuses a blank name and asks for an identity first", async () => {
    const treasurer = await person();
    const made = await createCommunityService(treasurer, { randomBytes }).create(" ");
    if (!made.ok) expect(made.error.message).toBe("Give your community a name.");
    else throw new Error("should not be made");
    const none = await createCommunityService(null, { randomBytes }).check("x");
    if (!none.ok) expect(none.error.message).toBe(INVITATION_MESSAGES.no_identity);
    else throw new Error("should not pass");
  });

  it("returns plain messages instead of throwing", async () => {
    const none = await createCommunityService(null, { randomBytes }).create("Stokvel");
    if (!none.ok) expect(none.error.message).toBe("Make your identity first.");
    else throw new Error("should not be made");
    const early = await createCommunityService(await person(), { randomBytes }).invite("x");
    if (!early.ok) expect(early.error.message).toBe("Make a community first.");
    else throw new Error("should not invite");
  });
});
