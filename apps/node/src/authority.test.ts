// The Node's check of authority (story 2.5), with a real community on the in-memory record: members join,
// hold roles, and present signed requests to `POST /authority/check`. Each refusal is tested with its reason.
import {
  DAY_MS,
  formatDay,
  signRequest,
  spaceUri,
  type Community,
  type RequestParts,
} from "@shopong/community";
import { createEvent, webCryptoSha512, type EventEnvelope } from "@shopong/events";
import type { CapabilityToken, Did } from "@shopong/ports";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.ts";
import { createLogger } from "./logger.ts";
import { captureSink } from "./testing/capture.ts";
import { community, phone, randomHex, T0, type Phone } from "./testing/community.ts";

const DAYS = (n: number) => n * DAY_MS;
const rand = (n: number) => ({ currency: "ZAR" as const, minor: n * 100 });
const SPACE_PATH = "/authority/check";

describe("POST /authority/check (AC 2.5)", () => {
  let running: FastifyInstance | undefined;
  afterEach(async () => {
    await running?.close();
    running = undefined;
  });

  /** Sends one request, signed by `signer` as `actor`, with the Node's clock at `nodeNow`. */
  async function send(
    app: FastifyInstance,
    signer: Phone,
    body: {
      token?: CapabilityToken;
      required: { with: string; can: string; ceiling?: { currency: string; minor: number } };
    },
    options: { time?: number; nonce?: string; actor?: Did; signedBody?: string } = {},
  ) {
    const text = JSON.stringify(body);
    const parts: RequestParts = {
      method: "POST",
      path: SPACE_PATH,
      body: options.signedBody ?? text,
      nonce: options.nonce ?? randomHex(16),
      time: options.time ?? T0 + 2 * DAY_MS,
      actor: signer.did,
    };
    const headers = await signRequest(signer.auth, parts, webCryptoSha512);
    if (!headers.ok) throw new Error(headers.error.message);
    const sent =
      options.actor === undefined
        ? headers.value
        : { ...headers.value, "x-ocn-actor": options.actor };
    return app.inject({
      method: "POST",
      url: SPACE_PATH,
      headers: { ...sent, "content-type": "application/json" },
      payload: text,
    });
  }

  /** Builds the Node over the community's record, and returns the driver's grant token and end. */
  async function node(nodeNow: number) {
    const w = await community();
    const granted = await w.founder.grantRole(w.driver.did, "driver", { days: 7 }, T0 + 2 * DAY_MS);
    if (!granted.ok) throw new Error(granted.error.message);
    await w.network.replicate<EventEnvelope>(w.founder.space, w.driverCommunity.space);
    const [record] = await w.driverCommunity.roles();
    const token = record?.grants[0]?.token;
    if (token === undefined || record === undefined) throw new Error("no grant");
    const sink = captureSink();
    const app = buildApp({
      logger: createLogger({ level: "info", sink }),
      version: "test",
      components: [],
      authority: {
        creator: w.creator.did,
        spaceKey: w.founder.space.key,
        view: w.founder.space.view,
        now: () => nodeNow,
      },
    });
    running = app;
    const required = { with: spaceUri(w.founder.key), can: "delivery/confirm" };
    return { ...w, app, token, record, required, sink };
  }

  it("allows a member's own role, verified with the Node's clock and no network", async () => {
    const n = await node(T0 + 2 * DAY_MS);
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("network read during authority check");
    }) as typeof fetch;
    let res;
    try {
      res = await send(n.app, n.driver, { token: n.token, required: n.required });
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ allowed: true, role: "driver", endsAt: n.record.expiresAt });
  });

  it("refuses a tampered proof, with the reason, and audit-logs it", async () => {
    const n = await node(T0 + 2 * DAY_MS);
    const at = Math.floor(n.token.length / 2);
    const tampered =
      `${n.token.slice(0, at)}${n.token[at] === "A" ? "B" : "A"}${n.token.slice(at + 1)}` as CapabilityToken;
    const res = await send(n.app, n.driver, { token: tampered, required: n.required });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      allowed: false,
      problem: "tampered",
      reason: "This proof can't be checked.",
    });
    expect(n.sink.text()).toContain('"audit":"authority.check"');
    expect(n.sink.text()).toContain('"outcome":"refused"');
  });

  it("refuses a missing proof", async () => {
    const n = await node(T0 + 2 * DAY_MS);
    const res = await send(n.app, n.driver, { required: n.required });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      problem: "missing_proof",
      reason: "Send the proof of your role with the request.",
    });
  });

  it("refuses member B presenting member A's role: \"This role isn't yours.\"", async () => {
    const n = await node(T0 + 2 * DAY_MS);
    const res = await send(n.app, n.other, { token: n.token, required: n.required });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ problem: "not_yours", reason: "This role isn't yours." });
  });

  it("refuses a role that has ended by the Node's clock, and names the day", async () => {
    const endsAt = T0 + 2 * DAY_MS + 7 * DAY_MS;
    const n = await node(endsAt + 1);
    const res = await send(
      n.app,
      n.driver,
      { token: n.token, required: n.required },
      { time: endsAt + 1 },
    );
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      problem: "ended",
      reason: `Your role ended on ${formatDay(endsAt)}.`,
    });
  });

  it("refuses an older grant once the record has replaced it", async () => {
    const n = await node(T0 + 3 * DAY_MS);
    const replaced = await n.founder.grantRole(
      n.driver.did,
      "driver",
      { days: 30 },
      T0 + 3 * DAY_MS,
    );
    if (!replaced.ok) throw new Error(replaced.error.message);
    const res = await send(
      n.app,
      n.driver,
      { token: n.token, required: n.required },
      { time: T0 + 3 * DAY_MS },
    );
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      problem: "not_current",
      reason: "Your role doesn't cover that.",
    });
  });

  it("refuses the same signed request sent twice", async () => {
    const n = await node(T0 + 2 * DAY_MS);
    const nonce = randomHex(16);
    const first = await send(n.app, n.driver, { token: n.token, required: n.required }, { nonce });
    expect(first.statusCode).toBe(200);
    const second = await send(n.app, n.driver, { token: n.token, required: n.required }, { nonce });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({
      problem: "replayed",
      reason: "That request was already used.",
    });
  });

  it("accepts a request within the clock skew, and refuses one outside it", async () => {
    const n = await node(T0 + 2 * DAY_MS);
    const within = await send(
      n.app,
      n.driver,
      { token: n.token, required: n.required },
      { time: T0 + 2 * DAY_MS - 60_000 },
    );
    expect(within.statusCode).toBe(200);
    const outside = await send(
      n.app,
      n.driver,
      { token: n.token, required: n.required },
      { time: T0 + 2 * DAY_MS - 3 * 60_000 },
    );
    expect(outside.statusCode).toBe(401);
    expect(outside.json()).toMatchObject({
      problem: "clock_skew",
      reason: "Check your phone's clock.",
    });
  });

  it("refuses an unsigned request, a changed body, and someone else's name", async () => {
    const n = await node(T0 + 2 * DAY_MS);
    const unsigned = await n.app.inject({
      method: "POST",
      url: SPACE_PATH,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ token: n.token, required: n.required }),
    });
    expect(unsigned.statusCode).toBe(401);
    expect(unsigned.json()).toMatchObject({ problem: "unsigned" });

    const changed = await send(
      n.app,
      n.driver,
      { token: n.token, required: { ...n.required, can: "payment/approve" } },
      { signedBody: JSON.stringify({ token: n.token, required: n.required }) },
    );
    expect(changed.statusCode).toBe(401);
    expect(changed.json()).toMatchObject({ problem: "unsigned" });

    const renamed = await send(
      n.app,
      n.driver,
      { token: n.token, required: n.required },
      { actor: n.other.did },
    );
    expect(renamed.statusCode).toBe(401);
  });

  it("refuses a grant built on a grant the creator has since replaced (review finding 1)", async () => {
    const w = await community();
    const G = w.driver;
    const A = w.other;
    await w.founder.grantRole(G.did, "co-treasurer", { limit: rand(10000), days: 90 }, T0);
    await w.network.replicate<EventEnvelope>(w.founder.space, w.driverCommunity.space);
    // G gives A R5,000 from the grant the founder gave G.
    const given = await w.driverCommunity.grantRole(
      A.did,
      "co-treasurer",
      { limit: rand(5000), days: 7 },
      T0 + DAYS(1),
    );
    if (!given.ok) throw new Error(given.error.message);
    await w.network.replicate<EventEnvelope>(w.founder.space, w.driverCommunity.space);
    await w.network.replicate<EventEnvelope>(w.founder.space, w.otherCommunity.space);
    const aRecord = (await w.otherCommunity.roles()).find((r) => r.role === "co-treasurer");
    const token = aRecord?.grants.find((g) => g.ability === "payment/approve")?.token;
    if (token === undefined) throw new Error("no grant for A");
    const nodeClock = { now: T0 + DAYS(2) };
    const sink = captureSink();
    const app = buildApp({
      logger: createLogger({ level: "info", sink }),
      version: "test",
      components: [],
      authority: {
        creator: w.creator.did,
        spaceKey: w.founder.space.key,
        view: w.founder.space.view,
        now: () => nodeClock.now,
      },
    });
    running = app;
    const request = {
      token,
      required: {
        with: spaceUri(w.founder.key),
        can: "payment/approve",
        ceiling: { currency: "ZAR", minor: 5000_00 },
      },
    };
    const before = await send(app, A, request, { time: nodeClock.now });
    expect(before.statusCode).toBe(200);

    // The founder re-grants G at R100: the grant A's chain goes through is no longer G's current grant.
    await w.founder.grantRole(G.did, "co-treasurer", { limit: rand(100), days: 90 }, T0 + DAYS(2));
    nodeClock.now = T0 + DAYS(3);
    const after = await send(app, A, request, { time: nodeClock.now });
    expect(after.statusCode).toBe(403);
    expect(after.json()).toMatchObject({
      problem: "not_current",
      reason: "Your role doesn't cover that.",
    });
  });

  it("refuses a one-time number that is not well formed, before it is recorded", async () => {
    const n = await node(T0 + 2 * DAY_MS);
    const signed = await signRequest(
      n.driver.auth,
      {
        method: "POST",
        path: SPACE_PATH,
        body: JSON.stringify({ token: n.token, required: n.required }),
        nonce: randomHex(16),
        time: T0 + 2 * DAY_MS,
        actor: n.driver.did,
      },
      webCryptoSha512,
    );
    if (!signed.ok) throw new Error(signed.error.message);
    const res = await n.app.inject({
      method: "POST",
      url: SPACE_PATH,
      headers: { ...signed.value, "x-ocn-nonce": "bad nonce!", "content-type": "application/json" },
      payload: JSON.stringify({ token: n.token, required: n.required }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ problem: "bad_nonce" });
  });

  it("caps the one-time numbers it holds, refuses when full, and frees them once they are too old to replay", async () => {
    const w = await community();
    const nodeClock = { now: T0 + 2 * DAY_MS };
    const sink = captureSink();
    const app = buildApp({
      logger: createLogger({ level: "info", sink }),
      version: "test",
      components: [],
      authority: {
        creator: w.creator.did,
        spaceKey: w.founder.space.key,
        view: w.founder.space.view,
        now: () => nodeClock.now,
        maxNonces: 2,
      },
    });
    running = app;
    const granted = await w.founder.grantRole(w.driver.did, "driver", { days: 7 }, nodeClock.now);
    if (!granted.ok) throw new Error(granted.error.message);
    const token = granted.value.tokens[0];
    const body = { token, required: { with: spaceUri(w.founder.key), can: "delivery/confirm" } };
    const first = await send(app, w.driver, body, { time: nodeClock.now });
    const second = await send(app, w.driver, body, { time: nodeClock.now });
    const full = await send(app, w.driver, body, { time: nodeClock.now });
    expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
    expect(full.statusCode).toBe(429);
    expect(full.json()).toMatchObject({
      problem: "busy",
      reason: "The Node is busy. Try again in a moment.",
    });

    nodeClock.now = T0 + 2 * DAY_MS + 5 * 60_000;
    const later = await send(app, w.driver, body, { time: nodeClock.now });
    expect(later.statusCode).toBe(200);
  });

  it("logs a claimed actor only as claimed until the signature passes, truncated to 80 characters", async () => {
    const w = await community();
    const sink = captureSink();
    const app = buildApp({
      logger: createLogger({ level: "info", sink }),
      version: "test",
      components: [],
      authority: {
        creator: w.creator.did,
        spaceKey: w.founder.space.key,
        view: w.founder.space.view,
        now: () => T0,
      },
    });
    running = app;
    const long = "x".repeat(200);
    const res = await app.inject({
      method: "POST",
      url: SPACE_PATH,
      headers: {
        "x-ocn-actor": long,
        "x-ocn-nonce": randomHex(16),
        "x-ocn-time": String(T0),
        "x-ocn-signature": "nope",
        "content-type": "application/json",
      },
      payload: "{}",
    });
    expect(res.statusCode).toBe(401);
    expect(sink.text()).toContain(`"claimedActor":"${"x".repeat(80)}"`);
    expect(sink.text()).not.toContain("x".repeat(81));
    expect(sink.text()).not.toContain('"actor"');
  });

  it("answers 503 when the Node has no community to check against", async () => {
    const sink = captureSink();
    const app = buildApp({
      logger: createLogger({ level: "info", sink }),
      version: "test",
      components: [],
    });
    running = app;
    const driver = await phone();
    const res = await send(
      app,
      driver,
      { required: { with: "ocn:space/x", can: "delivery/confirm" } },
      { time: Date.now() },
    );
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ problem: "not_configured" });
  });

  it("answers for the community a request names, from the records the Node holds (closes S-2.5-15)", async () => {
    const w = await community();
    // The Node's guard runs on the device clock when no single community is configured, so the times here are real.
    const now = Date.now();
    const granted = await w.founder.grantRole(w.driver.did, "driver", { days: 7 }, now - DAY_MS);
    if (!granted.ok) throw new Error(granted.error.message);
    await w.network.replicate<EventEnvelope>(w.founder.space, w.driverCommunity.space);
    const [record] = await w.driverCommunity.roles();
    const token = record?.grants[0]?.token;
    if (token === undefined) throw new Error("no grant");
    const sink = captureSink();
    const app = buildApp({
      logger: createLogger({ level: "info", sink }),
      version: "test",
      components: [],
      authorityOf: async (key) =>
        key === w.founder.key
          ? { creator: w.creator.did, spaceKey: key, view: w.founder.space.view }
          : undefined,
    });
    running = app;
    const allowed = await send(
      app,
      w.driver,
      { token, required: { with: spaceUri(w.founder.key), can: "delivery/confirm" } },
      { time: now },
    );
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toMatchObject({ allowed: true, role: "driver" });
    const elsewhere = await send(
      app,
      w.driver,
      { token, required: { with: spaceUri("ef".repeat(32)), can: "delivery/confirm" } },
      { time: now },
    );
    expect(elsewhere.statusCode).toBe(503);
    expect(elsewhere.json()).toMatchObject({ problem: "not_configured" });
  });

  it("never writes a token or a signature to the Node's log", async () => {
    const n = await node(T0 + 2 * DAY_MS);
    const allowed = await send(n.app, n.driver, { token: n.token, required: n.required });
    expect(allowed.statusCode).toBe(200);
    const refused = await send(n.app, n.other, { token: n.token, required: n.required });
    expect(refused.statusCode).toBe(403);
    expect(n.sink.text()).toContain('"audit":"authority.check"');
    expect(n.sink.text()).not.toContain(n.token);
    expect(n.sink.text()).not.toContain(
      allowed.headers["x-ocn-signature"] ?? "no-signature-echoed",
    );
    expect(n.sink.text()).not.toMatch(/signature/);
  });

  /** Moves the record's log time to `at` with the founder's own quotes, one day at a time (the cap, story 3.6). */
  async function recordAt(w: Awaited<ReturnType<typeof community>>, at: number, from: number) {
    let step = 0;
    for (let t = from + DAY_MS; t < at; t += DAY_MS) {
      await addQuoteAt(w.founder, t, step++);
    }
    await addQuoteAt(w.founder, at, step);
  }

  async function addQuoteAt(founder: Community, at: number, step: number) {
    const added = await founder.addQuote(
      {
        supplier: "Thandi Wholesale",
        order: `Log ${step}`,
        lines: [{ item: "Sugar", unit: "bag", packSize: 1, pricePerPackCents: 12500 }],
        delivery: { feeCents: 0, days: 0 },
      },
      at,
    );
    if (!added.ok) throw new Error(added.error.message);
  }

  it("refuses a role the record's log time has ended, even when the Node's clock has not", async () => {
    // The Node's clock says day 2; the record has moved on to the day after the role ends.
    const n = await node(T0 + 2 * DAY_MS);
    await recordAt(n, n.record.expiresAt + DAY_MS, T0 + 2 * DAY_MS);
    const res = await send(n.app, n.driver, { token: n.token, required: n.required });
    expect(res.statusCode).not.toBe(200);
    expect(res.json()).toMatchObject({
      allowed: false,
      reason: `Your role ended on ${formatDay(n.record.expiresAt)}.`,
    });
  });

  it("refuses a role that has been taken back in the record", async () => {
    const n = await node(T0 + 2 * DAY_MS);
    const built = createEvent({
      type: "role.revoked",
      space: n.founder.key,
      actor: n.creator.did,
      proof: [],
      claimedAt: T0 + 3 * DAY_MS,
      nonce: randomHex(16),
      payload: { role: "driver", grantee: n.driver.did },
    } as never) as EventEnvelope;
    const receipt = await n.founder.space.append(built);
    if (!receipt.ok) throw new Error(receipt.error.message);
    await n.founder.space.update();
    const res = await send(n.app, n.driver, { token: n.token, required: n.required });
    expect(res.statusCode).not.toBe(200);
    expect(res.json()).toMatchObject({ allowed: false, reason: "This role has been taken back." });
  });
});
