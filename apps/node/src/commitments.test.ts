// The Node's commitment route (story 2.7): a member's signed request for the commitment of a phone or ID
// number. The community secret stays on the Node; the phone gets back only the commitment. The route uses the
// same signed-request check as `/authority/check` (one-time number, time, signature, replay).
import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import { createMemoryRecordNetwork } from "@shopong/adapters-memory";
import {
  DAY_MS,
  checkInvitation,
  communityDefinition,
  createCommunity,
  joinCommunity,
  signRequest,
  type Community,
  type CommunityDeps,
  type RequestParts,
} from "@shopong/community";
import { PHONE_NUMBER_MESSAGE, webCryptoSha512, type EventEnvelope } from "@shopong/events";
import type { CapabilityAuth, Did } from "@shopong/ports";
import { runCommitmentsContract } from "@shopong/ports-contract";
import golden from "@shopong/events/vectors/golden.json" with { type: "json" };
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.ts";
import { nodeCommitments } from "./commitments.ts";
import { COMMITMENT_MESSAGES } from "./commitment-route.ts";
import { createLogger } from "./logger.ts";
import { captureSink } from "./testing/capture.ts";

const T0 = 1_793_000_000_000;
const ROUTE = "/commitments";
const SECRET_0 = new Uint8Array(Array.from({ length: 32 }, (_, i) => i));
const SECRET_1 = new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 1));
const SHORT = new Uint8Array(16).fill(7);

function vector(value: string, secretHex: string): string {
  const v = golden.commitments.find((c) => c.value === value && c.secretHex === secretHex);
  if (!v) throw new Error(`no golden vector for ${value}`);
  return v.commitment;
}
const SECRET_0_HEX = Buffer.from(SECRET_0).toString("hex");

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

interface Phone {
  auth: CapabilityAuth;
  did: Did;
  deps: CommunityDeps;
}

async function phone(): Promise<Phone> {
  const auth = new IsoUcanCapabilityAuth();
  const did = await auth.createIdentity();
  return {
    auth,
    did,
    deps: {
      auth,
      sha512: webCryptoSha512,
      randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
    },
  };
}

/** A community with its creator, one member who joined, and an outsider who was never invited. */
async function world() {
  const network = createMemoryRecordNetwork();
  const creator = await phone();
  const made = await createCommunity(
    creator.deps,
    network.peer<EventEnvelope>(creator.did),
    "Test",
    T0,
  );
  if (!made.ok) throw new Error(made.error.message);
  const founder: Community = made.value;

  const member = await phone();
  const outsider = await phone();
  const invited = await founder.invite(member.did, T0);
  if (!invited.ok) throw new Error(invited.error.message);
  const space = await network
    .peer<EventEnvelope>(member.did)
    .open(founder.space.key, communityDefinition(member.deps, creator.did, founder.key));
  await network.replicate<EventEnvelope>(founder.space, space);
  const checked = await checkInvitation({
    auth: member.auth,
    text: invited.value.code,
    me: member.did,
    now: T0 + DAY_MS,
  });
  if (!checked.ok) throw new Error(checked.error.message);
  const joined = await joinCommunity(member.deps, space, checked.value, T0 + DAY_MS);
  if (!joined.ok) throw new Error(joined.error.message);
  await network.replicate<EventEnvelope>(founder.space, joined.value.space);
  return { founder, creator, member, outsider, network, memberSpace: joined.value.space };
}

describe("Node commitments (the Commitments contract)", () => {
  runCommitmentsContract(() => {
    const keys = { a: "a".repeat(64), b: "b".repeat(64), short: "s".repeat(64) };
    return {
      commitments: nodeCommitments(
        new Map([
          [keys.a, SECRET_0],
          [keys.b, SECRET_1],
          [keys.short, SHORT],
        ]),
      ),
      a: keys.a,
      b: keys.b,
      short: keys.short,
      unknown: "u".repeat(64),
    };
  });
});

describe("POST /commitments", () => {
  let running: FastifyInstance | undefined;
  afterEach(async () => {
    await running?.close();
    running = undefined;
  });

  /** Sends one signed request as `signer`, timed by the Node's clock unless `time` is given. */
  async function send(
    app: FastifyInstance,
    signer: Phone,
    body: unknown,
    options: { nonce?: string; time?: number; clock: () => number },
  ) {
    const text = typeof body === "string" ? body : JSON.stringify(body);
    const parts: RequestParts = {
      method: "POST",
      path: ROUTE,
      body: text,
      nonce: options.nonce ?? randomHex(16),
      time: options.time ?? options.clock(),
      actor: signer.did,
    };
    const headers = await signRequest(signer.auth, parts, webCryptoSha512);
    if (!headers.ok) throw new Error(headers.error.message);
    return app.inject({
      method: "POST",
      url: ROUTE,
      headers: { ...headers.value, "content-type": "application/json" },
      payload: text,
    });
  }

  /** The Node over a community: the creator is the treasurer, the view is the creator's. */
  async function node(secret: Uint8Array | "short" | undefined, options: { route?: boolean } = {}) {
    const w = await world();
    const secrets = new Map<string, Uint8Array>();
    if (secret === "short") secrets.set(w.founder.key, SHORT);
    else if (secret !== undefined) secrets.set(w.founder.key, secret);
    const sink = captureSink();
    let nowMs = T0 + 2 * DAY_MS;
    const clock = () => nowMs;
    const app = buildApp({
      logger: createLogger({ level: "info", sink }),
      version: "test",
      components: [],
      authority: {
        creator: w.creator.did,
        spaceKey: w.founder.key,
        view: w.founder.space.view,
        now: clock,
      },
      ...(options.route === false ? {} : { commitments: nodeCommitments(secrets) }),
    });
    running = app;
    return {
      ...w,
      app,
      sink,
      clock,
      advance: (ms: number) => {
        nowMs += ms;
      },
    };
  }

  /** Makes `member` a co-treasurer for seven days, and replicates nothing else: the Node reads the founder's view. */
  async function makeCoTreasurer(n: Awaited<ReturnType<typeof node>>) {
    const granted = await n.founder.grantRole(
      n.member.did,
      "co-treasurer",
      { limit: { currency: "ZAR", minor: 1_000_000 }, days: 7 },
      T0 + 2 * DAY_MS,
    );
    if (!granted.ok) throw new Error(granted.error.message);
  }

  it("gives the treasurer the golden commitment of a phone number, however it is spelled", async () => {
    const n = await node(SECRET_0);
    for (const spelling of ["082 123 4567", "+27 (0)82 123 4567"]) {
      const res = await send(
        n.app,
        n.creator,
        { kind: "phone", value: spelling },
        { clock: n.clock },
      );
      expect(res.statusCode).toBe(200);
      expect(res.json().commitment).toBe(vector("+27821234567", SECRET_0_HEX));
    }
  });

  it("gives the treasurer the golden commitment of an ID number", async () => {
    const n = await node(SECRET_0);
    const res = await send(
      n.app,
      n.creator,
      { kind: "id-number", value: "800101 5009 087" },
      { clock: n.clock },
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().commitment).toBe(vector("8001015009087", SECRET_0_HEX));
  });

  it("never sends the secret, and never logs the value or the secret (AGENTS rule 4)", async () => {
    const n = await node(SECRET_0);
    const res = await send(
      n.app,
      n.creator,
      { kind: "phone", value: "082 123 4567" },
      { clock: n.clock },
    );
    expect(res.body).not.toContain(SECRET_0_HEX);
    expect(res.body).not.toContain(Buffer.from(SECRET_0).toString("base64"));
    expect(n.sink.text()).not.toContain("082 123 4567");
    expect(n.sink.text()).not.toContain(SECRET_0_HEX);
  });

  it("refuses a request that is not signed by the person it names", async () => {
    const n = await node(SECRET_0);
    const res = await n.app.inject({
      method: "POST",
      url: ROUTE,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ kind: "phone", value: "082 123 4567" }),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().problem).toBe("unsigned");
  });

  it("refuses a signed member who is not the treasurer (review H3)", async () => {
    const n = await node(SECRET_0);
    const res = await send(
      n.app,
      n.member,
      { kind: "phone", value: "082 123 4567" },
      { clock: n.clock },
    );
    expect(res.statusCode).toBe(403);
    expect(res.json().problem).toBe("not_treasurer");
    expect(res.json().reason).toBe(COMMITMENT_MESSAGES.not_treasurer);
  });

  it("refuses a signed request from someone who is not in the community at all", async () => {
    const n = await node(SECRET_0);
    const res = await send(
      n.app,
      n.outsider,
      { kind: "phone", value: "082 123 4567" },
      { clock: n.clock },
    );
    expect(res.statusCode).toBe(403);
    expect(res.json().problem).toBe("not_treasurer");
  });

  it("allows a current co-treasurer", async () => {
    const n = await node(SECRET_0);
    await makeCoTreasurer(n);
    const res = await send(
      n.app,
      n.member,
      { kind: "phone", value: "082 123 4567" },
      { clock: n.clock },
    );
    expect(res.statusCode).toBe(200);
  });

  it("does not record the one-time number of a refused stranger (review M4)", async () => {
    const n = await node(SECRET_0);
    const nonce = randomHex(16);
    const body = { kind: "phone", value: "082 123 4567" };
    const first = await send(n.app, n.outsider, body, { nonce, clock: n.clock });
    expect(first.statusCode).toBe(403);
    // The same number, sent again, is refused for the same reason, not as a replay.
    const second = await send(n.app, n.outsider, body, { nonce, clock: n.clock });
    expect(second.statusCode).toBe(403);
    expect(second.json().problem).toBe("not_treasurer");
  });

  it("refuses a replayed request from the treasurer", async () => {
    const n = await node(SECRET_0);
    const nonce = randomHex(16);
    const body = { kind: "phone", value: "082 123 4567" };
    expect((await send(n.app, n.creator, body, { nonce, clock: n.clock })).statusCode).toBe(200);
    const again = await send(n.app, n.creator, body, { nonce, clock: n.clock });
    expect(again.statusCode).toBe(409);
    expect(again.json().problem).toBe("replayed");
  });

  it("refuses a request whose time is outside the allowed skew", async () => {
    const n = await node(SECRET_0);
    const res = await send(
      n.app,
      n.creator,
      { kind: "phone", value: "082 123 4567" },
      {
        time: n.clock() - 10 * 60 * 1000,
        clock: n.clock,
      },
    );
    expect(res.statusCode).toBe(401);
    expect(res.json().problem).toBe("clock_skew");
  });

  it("allows 30 requests in ten minutes and refuses the 31st with a plain 429 (review H3)", async () => {
    const n = await node(SECRET_0);
    const body = { kind: "phone", value: "082 123 4567" };
    for (let i = 0; i < 30; i++) {
      const res = await send(n.app, n.creator, body, { clock: n.clock });
      expect(res.statusCode, `request ${i + 1}`).toBe(200);
    }
    const refused = await send(n.app, n.creator, body, { clock: n.clock });
    expect(refused.statusCode).toBe(429);
    expect(refused.json().problem).toBe("rate_limited");
    expect(refused.json().reason).toBe("Too many requests. Try again later.");
  });

  it("allows requests again once the ten-minute window has passed (review H3)", async () => {
    const n = await node(SECRET_0);
    const body = { kind: "phone", value: "082 123 4567" };
    for (let i = 0; i < 30; i++) await send(n.app, n.creator, body, { clock: n.clock });
    expect((await send(n.app, n.creator, body, { clock: n.clock })).statusCode).toBe(429);
    n.advance(10 * 60 * 1000 + 1);
    expect((await send(n.app, n.creator, body, { clock: n.clock })).statusCode).toBe(200);
  });

  it("refuses a body that names no kind of value", async () => {
    const n = await node(SECRET_0);
    const res = await send(n.app, n.creator, { kind: "name", value: "Thandi" }, { clock: n.clock });
    expect(res.statusCode).toBe(400);
    expect(res.json().problem).toBe("invalid_request");
  });

  it("refuses a phone number that is not one, with the plain reason", async () => {
    const n = await node(SECRET_0);
    const res = await send(
      n.app,
      n.creator,
      { kind: "phone", value: "not a number" },
      { clock: n.clock },
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().reason).toBe(PHONE_NUMBER_MESSAGE);
  });

  it("refuses an ID number with a bad check digit, with the plain reason", async () => {
    const n = await node(SECRET_0);
    const res = await send(
      n.app,
      n.creator,
      { kind: "id-number", value: "8001015009088" },
      { clock: n.clock },
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().reason).toBe("That doesn't look like an ID number.");
  });

  it("refuses with a plain reason when the community's secret is too short", async () => {
    const n = await node("short");
    const res = await send(
      n.app,
      n.creator,
      { kind: "phone", value: "082 123 4567" },
      { clock: n.clock },
    );
    expect(res.statusCode).toBe(503);
    expect(res.json().reason).toBe("This community's secret is too short.");
  });

  it("refuses when this Node has no secret for the community", async () => {
    const n = await node(undefined);
    const res = await send(
      n.app,
      n.creator,
      { kind: "phone", value: "082 123 4567" },
      { clock: n.clock },
    );
    expect(res.statusCode).toBe(503);
    expect(res.json().problem).toBe("no_secret");
  });

  it("refuses when no commitment route is configured", async () => {
    const n = await node(SECRET_0, { route: false });
    const res = await send(
      n.app,
      n.creator,
      { kind: "phone", value: "082 123 4567" },
      { clock: n.clock },
    );
    expect(res.statusCode).toBe(503);
    expect(res.json().problem).toBe("not_configured");
  });
});
