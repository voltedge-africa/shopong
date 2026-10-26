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

  it("gives a role only to a member, and says so plainly", async () => {
    const treasurer = await person();
    const stranger = await person();
    const mine = createCommunityService(treasurer, { randomBytes, now: () => 1_793_000_000_000 });
    await mine.create("Ntombi Stokvel");
    const refused = await mine.grant(stranger.did, "driver", {});
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toBe("Invite them to the community first.");
    const self = await mine.grant(treasurer.did, "driver", {});
    if (!self.ok) expect(self.error.message).toBe("You already hold every role.");
    else throw new Error("the creator should not grant themselves a role");
  });

  it("has no roles and refuses an action before a community is made, and for a creator with no role", async () => {
    const treasurer = await person();
    const mine = createCommunityService(treasurer, { randomBytes, now: () => 1_793_000_000_000 });
    expect(await mine.roles()).toEqual([]);
    const before = await mine.checkAction({ ability: "delivery/confirm" });
    if (!before.ok) expect(before.error.message).toBe("Your role doesn't cover that.");
    else throw new Error("nothing should be allowed before a community");
    await mine.create("Ntombi Stokvel");
    const creator = await mine.checkAction({ ability: "delivery/confirm" });
    if (!creator.ok) expect(creator.error.message).toBe("Your role doesn't cover that.");
    else throw new Error("the creator holds no role until one is given");
    const grantBefore = await createCommunityService(await person(), { randomBytes }).grant(
      treasurer.did,
      "driver",
      {},
    );
    if (!grantBefore.ok) expect(grantBefore.error.message).toBe("Make a community first.");
    else throw new Error("no community, no grant");
  });
});
