// The one authority check (`verifyAuthority`) and the device's checks built on it. Each refusal is
// tested with its problem code; a valid chain is checked with the network trapped and no clock read.
import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import { money, type CapabilityToken, type Did } from "@shopong/ports";
import { describe, expect, it } from "vite-plus/test";
import { verifyAuthority, type AuthorityRequest } from "./authority.js";
import { checkInvitation, DAY_MS, issueInvitation, spaceUri } from "./index.js";

const T0 = 1_793_000_000_000;
const KEY = "ab".repeat(32);
const SPACE = spaceUri(KEY);
const HOUR = 3_600_000;

async function setup() {
  const auth = new IsoUcanCapabilityAuth();
  const root = await auth.createIdentity();
  const holder = await auth.createIdentity();
  const other = await auth.createIdentity();
  const grant = async (ceiling?: number) => {
    const issued = await auth.issue({
      issuer: root,
      audience: holder,
      capabilities: [
        {
          with: SPACE,
          can: "payment/approve",
          ...(ceiling === undefined ? {} : { ceiling: money("ZAR", ceiling) }),
        },
      ],
      notBefore: T0,
      expiresAt: T0 + 10 * HOUR,
    });
    if (!issued.ok) throw new Error(issued.error.message);
    return issued.value;
  };
  const request = (overrides: Partial<AuthorityRequest> = {}): AuthorityRequest => ({
    holder,
    rootIssuer: root,
    required: { with: SPACE, can: "payment/approve" },
    at: T0 + HOUR,
    isCurrentGrant: () => true,
    ...overrides,
  });
  return { auth, root, holder, other, grant, request };
}

function tamper(token: CapabilityToken): CapabilityToken {
  const at = Math.floor(token.length / 2);
  return `${token.slice(0, at)}${token[at] === "A" ? "B" : "A"}${token.slice(at + 1)}` as CapabilityToken;
}

describe("verifyAuthority: one check, a problem code for each refusal", () => {
  it("accepts a valid grant and reports its end", async () => {
    const w = await setup();
    const verified = await verifyAuthority(w.auth, await w.grant(), w.request());
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.value.endsAt).toBe(T0 + 10 * HOUR);
  });

  it("refuses a missing token as missing_proof", async () => {
    const w = await setup();
    const refused = await verifyAuthority(w.auth, undefined, w.request());
    expect(refused.ok ? undefined : refused.error.code).toBe("missing_proof");
  });

  it("refuses a changed token as tampered", async () => {
    const w = await setup();
    const refused = await verifyAuthority(w.auth, tamper(await w.grant()), w.request());
    expect(refused.ok ? undefined : refused.error.code).toBe("tampered");
  });

  it("refuses a token issued to someone else as not_yours", async () => {
    const w = await setup();
    const refused = await verifyAuthority(w.auth, await w.grant(), w.request({ holder: w.other }));
    expect(refused.ok ? undefined : refused.error.code).toBe("not_yours");
  });

  it("refuses an ended and a not yet started role, with the day", async () => {
    const w = await setup();
    const token = await w.grant();
    const ended = await verifyAuthority(w.auth, token, w.request({ at: T0 + 10 * HOUR }));
    expect(ended.ok ? undefined : [ended.error.code, ended.error.at]).toEqual([
      "ended",
      T0 + 10 * HOUR,
    ]);
    const early = await verifyAuthority(w.auth, token, w.request({ at: T0 - 1 }));
    expect(early.ok ? undefined : [early.error.code, early.error.at]).toEqual(["not_started", T0]);
  });

  it("refuses a capability the token does not cover as outside", async () => {
    const w = await setup();
    const refused = await verifyAuthority(
      w.auth,
      await w.grant(),
      w.request({ required: { with: SPACE, can: "member/invite" } }),
    );
    expect(refused.ok ? undefined : refused.error.code).toBe("outside");
  });

  it("refuses an amount above the ceiling as over_limit, with the limit", async () => {
    const w = await setup();
    const refused = await verifyAuthority(
      w.auth,
      await w.grant(500_00),
      w.request({
        required: { with: SPACE, can: "payment/approve", ceiling: money("ZAR", 600_00) },
      }),
    );
    expect(refused.ok ? undefined : [refused.error.code, refused.error.limit]).toEqual([
      "over_limit",
      money("ZAR", 500_00),
    ]);
  });

  it("refuses a revoked token as revoked", async () => {
    const w = await setup();
    const token = await w.grant();
    const id = await w.auth.tokenId(token);
    const refused = await verifyAuthority(
      w.auth,
      token,
      w.request({ isRevoked: (tokenId) => tokenId === id }),
    );
    expect(refused.ok ? undefined : refused.error.code).toBe("revoked");
  });

  it("verifies a valid chain with the network trapped and no clock read", async () => {
    const w = await setup();
    const token = await w.grant();
    const realFetch = globalThis.fetch;
    const realNow = Date.now;
    globalThis.fetch = (() => {
      throw new Error("network read during verify");
    }) as typeof fetch;
    Date.now = () => {
      throw new Error("clock read during verify");
    };
    try {
      expect((await verifyAuthority(w.auth, token, w.request())).ok).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
      Date.now = realNow;
    }
  });
});

describe("the device's invitation check uses the same check", () => {
  it("refuses a tampered invitation on the phone with a plain reason, with no network", async () => {
    const w = await setup();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("network read on the phone");
    }) as typeof fetch;
    try {
      const issued = await issueInvitation({
        auth: w.auth,
        creator: w.root,
        spaceKey: KEY,
        invitee: w.holder,
        now: T0,
      });
      if (!issued.ok) throw new Error(issued.error.message);
      const checked = await checkInvitation({
        auth: w.auth,
        text: issued.value.code.replace(issued.value.token, tamper(issued.value.token)),
        me: w.holder,
        now: T0 + DAY_MS,
      });
      expect(checked.ok ? undefined : checked.error.message).toBe(
        "This invitation can't be checked.",
      );
      const valid = await checkInvitation({
        auth: w.auth,
        text: issued.value.code,
        me: w.holder,
        now: T0 + DAY_MS,
      });
      expect(valid.ok).toBe(true);
      const asSomeoneElse = await checkInvitation({
        auth: w.auth,
        text: issued.value.code,
        me: w.other as Did,
        now: T0 + DAY_MS,
      });
      expect(asSomeoneElse.ok ? undefined : asSomeoneElse.error.message).toBe(
        "This invitation is for someone else.",
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("an invitation with no proof in it (review finding 9)", () => {
  it("is refused on the phone as a missing proof, not as unreadable", async () => {
    const w = await setup();
    const text = `shopong://join?space=${KEY}&creator=${encodeURIComponent(w.root)}`;
    const checked = await checkInvitation({ auth: w.auth, text, me: w.holder, now: T0 + DAY_MS });
    expect(checked.ok ? undefined : checked.error.message).toBe(
      "This invitation has no proof in it.",
    );
  });
});
