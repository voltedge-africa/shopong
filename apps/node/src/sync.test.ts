// The Node's signed sync routes (story 3.5): an append is signed with the request-proof scheme, and the
// Node refuses it before it touches the record. Each security row of the plan has a test; the record is a
// real in-memory SharedRecord, and a Proxy counts the calls that reach its `append`.
import {
  NOT_THE_WRITER,
  REQUEST_SKEW_MS,
  signRequest,
  type RequestParts,
} from "@shopong/community";
import {
  PERSONAL_DATA_MESSAGE,
  createEvent,
  eventIdOf,
  webCryptoSha512,
  type EventEnvelope,
} from "@shopong/events";
import golden from "@shopong/events/vectors/golden.json" with { type: "json" };
import type { Did, Space } from "@shopong/ports";
import type { SyncHub } from "./sync.ts";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.ts";
import { createLogger } from "./logger.ts";
import { captureSink } from "./testing/capture.ts";
import { community, randomHex, T0, type Phone } from "./testing/community.ts";

const NOW = T0 + 2 * REQUEST_SKEW_MS;

/** A hub that answers with one replica per call. The gate tests need no indexer, so the rest answers "not held". */
function fakeHub(replicaFor: (did: Did, key: string) => Space<EventEnvelope> | undefined): SyncHub {
  return {
    isMember: async () => true,
    replicaOf: async (did, key) => replicaFor(did, key),
    acknowledge: () => {},
    readSince: async () => ({ ok: false, problem: "not_held" }),
    onChange: async () => undefined,
  };
}

interface Counted {
  readonly space: Space<EventEnvelope>;
  /** Calls that reached the record's `append`. */
  readonly appends: () => number;
}

/** The space, with its `append` counted. Every other member is passed through unchanged. */
function counted(space: Space<EventEnvelope>): Counted {
  let calls = 0;
  const proxy = new Proxy(space, {
    get(target, property) {
      if (property === "append") {
        return (event: EventEnvelope) => {
          calls++;
          return target.append(event);
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function"
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  }) as Space<EventEnvelope>;
  return { space: proxy, appends: () => calls };
}

describe("the Node's signed sync routes (AC 3.5)", () => {
  let running: FastifyInstance | undefined;
  afterEach(async () => {
    await running?.close();
    running = undefined;
  });

  async function setup() {
    const w = await community();
    const held = counted(w.driverCommunity.space);
    const sink = captureSink();
    running = buildApp({
      logger: createLogger({ level: "info", sink }),
      version: "test",
      components: [],
      sync: {
        hub: fakeHub((_did, key) => (key === w.driverCommunity.key ? held.space : undefined)),
        now: () => NOW,
      },
    });
    return { w, held, app: running, sink };
  }

  /** A `member.joined` event written by `actor` for `space`. Its id is SHA-512 of the canonical JSON. */
  function eventFor(space: string, actor: Phone["did"], nonce = randomHex(16)) {
    return createEvent({
      type: "member.joined",
      space,
      actor,
      proof: [],
      claimedAt: NOW,
      nonce,
      payload: { invitation: "founder" },
    });
  }

  /** Signs and sends one append to `/spaces/<space>/events`. Options override one part for a refusal test. */
  async function send(
    app: FastifyInstance,
    signer: Phone,
    space: string,
    event: unknown,
    options: {
      nonce?: string;
      time?: number;
      actor?: string;
      signedBody?: string;
      sendBody?: string;
      unsigned?: boolean;
    } = {},
  ) {
    const path = `/spaces/${space}/events`;
    const text = JSON.stringify(event);
    const parts: RequestParts = {
      method: "POST",
      path,
      body: options.signedBody ?? text,
      nonce: options.nonce ?? randomHex(16),
      time: options.time ?? NOW,
      actor: signer.did,
    };
    const signed = await signRequest(signer.auth, parts, webCryptoSha512);
    if (!signed.ok) throw new Error(signed.error.message);
    const headers =
      options.unsigned === true
        ? {}
        : options.actor === undefined
          ? signed.value
          : { ...signed.value, "x-ocn-actor": options.actor };
    return app.inject({
      method: "POST",
      url: path,
      headers: { ...headers, "content-type": "application/json" },
      payload: options.sendBody ?? text,
    });
  }

  it("answers a signed append with the event id, and writes it once", async () => {
    const { w, held, app } = await setup();
    const event = eventFor(w.driverCommunity.key, w.driver.did);
    const res = await send(app, w.driver, w.driverCommunity.key, event);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: await eventIdOf(event, webCryptoSha512),
      duplicate: false,
    });
    expect(held.appends()).toBe(1);
  });

  it("answers the same event again with duplicate true, and nothing new", async () => {
    const { w, app } = await setup();
    const event = eventFor(w.driverCommunity.key, w.driver.did);
    await send(app, w.driver, w.driverCommunity.key, event);
    const again = await send(app, w.driver, w.driverCommunity.key, event);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ duplicate: true });
  });

  it("refuses an unsigned append before the record is touched", async () => {
    const { w, held, app } = await setup();
    const res = await send(
      app,
      w.driver,
      w.driverCommunity.key,
      eventFor(w.driverCommunity.key, w.driver.did),
      {
        unsigned: true,
      },
    );
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ problem: "unsigned" });
    expect(held.appends()).toBe(0);
  });

  it("refuses a replayed append: the same signed request a second time", async () => {
    const { w, held, app } = await setup();
    const event = eventFor(w.driverCommunity.key, w.driver.did);
    const nonce = randomHex(16);
    const first = await send(app, w.driver, w.driverCommunity.key, event, { nonce });
    expect(first.statusCode).toBe(200);
    const replay = await send(app, w.driver, w.driverCommunity.key, event, { nonce });
    expect(replay.statusCode).toBe(409);
    expect(replay.json()).toMatchObject({ problem: "replayed" });
    expect(held.appends()).toBe(1);
  });

  it("refuses a request whose claimed actor is not the key that signed it", async () => {
    const { w, held, app } = await setup();
    const res = await send(
      app,
      w.other,
      w.driverCommunity.key,
      eventFor(w.driverCommunity.key, w.driver.did),
      {
        actor: w.driver.did,
      },
    );
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ problem: "unsigned" });
    expect(held.appends()).toBe(0);
  });

  it("refuses a body changed after it was signed", async () => {
    const { w, held, app } = await setup();
    const event = eventFor(w.driverCommunity.key, w.driver.did);
    const tampered = { ...event, claimedAt: NOW + 1 };
    const res = await send(app, w.driver, w.driverCommunity.key, tampered, {
      signedBody: JSON.stringify(event),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ problem: "unsigned" });
    expect(held.appends()).toBe(0);
  });

  it("refuses someone else's event, even from a signed caller", async () => {
    const { w, held, app } = await setup();
    const res = await send(
      app,
      w.driver,
      w.driverCommunity.key,
      eventFor(w.driverCommunity.key, w.other.did),
    );
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ problem: "not_yours", reason: NOT_THE_WRITER });
    expect(held.appends()).toBe(0);
  });

  it("answers 403 not_member, not 500, when the replica is closed during the request (a removal, story 3.3)", async () => {
    const w = await community();
    // The replica is closed while the request is in flight: its append answers `closed`.
    const closed = new Proxy(w.driverCommunity.space, {
      get(target, property) {
        if (property === "append") {
          return async () => ({ ok: false, error: { code: "closed", message: "space is closed" } });
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function"
          ? (value as (...a: unknown[]) => unknown).bind(target)
          : value;
      },
    }) as Space<EventEnvelope>;
    running = buildApp({
      logger: createLogger({ level: "info", sink: captureSink() }),
      version: "test",
      components: [],
      sync: { hub: fakeHub(() => closed), now: () => NOW },
    });
    const key = w.driverCommunity.key;
    const res = await send(running, w.driver, key, eventFor(key, w.driver.did));
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ problem: "not_member" });
  });

  it("refuses an append the held replica would make as someone else", async () => {
    // The replica the Node holds writes as `other`; a validly signed event by `driver` must not go through it.
    const w = await community();
    const heldByOther = counted(w.otherCommunity.space);
    running = buildApp({
      logger: createLogger({ level: "info", sink: captureSink() }),
      version: "test",
      components: [],
      sync: { hub: fakeHub(() => heldByOther.space), now: () => NOW },
    });
    const key = w.otherCommunity.key;
    const res = await send(running, w.driver, key, eventFor(key, w.driver.did));
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ problem: "not_yours" });
    expect(heldByOther.appends()).toBe(0);
  });

  it("answers 404 for a space the Node does not hold, and 400 for an event of another space", async () => {
    const { w, held, app } = await setup();
    const unknown = await send(
      app,
      w.driver,
      "ab".repeat(32),
      eventFor("ab".repeat(32), w.driver.did),
    );
    expect(unknown.statusCode).toBe(404);
    const wrongSpace = await send(
      app,
      w.driver,
      w.driverCommunity.key,
      eventFor("cd".repeat(32), w.driver.did),
    );
    expect(wrongSpace.statusCode).toBe(400);
    expect(held.appends()).toBe(0);
  });
  it("refuses a raw phone number in the payload before the append, and appends nothing (story 2.7)", async () => {
    const { w, held, app } = await setup();
    const event = createEvent({
      type: "agent.action",
      space: w.driverCommunity.key,
      actor: w.driver.did,
      proof: [],
      claimedAt: NOW,
      nonce: randomHex(16),
      payload: { title: "Groceries", contact: "082 123 4567" },
    });
    const res = await send(app, w.driver, w.driverCommunity.key, event);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ problem: "personal_data", reason: PERSONAL_DATA_MESSAGE });
    expect(held.appends()).toBe(0);
  });

  it("accepts an event whose personal field holds a commitment", async () => {
    const { w, held, app } = await setup();
    const commitment = golden.commitments[0]?.commitment ?? "";
    const event = createEvent({
      type: "agent.action",
      space: w.driverCommunity.key,
      actor: w.driver.did,
      proof: [],
      claimedAt: NOW,
      nonce: randomHex(16),
      payload: { contact: commitment },
    });
    const res = await send(app, w.driver, w.driverCommunity.key, event);
    expect(res.statusCode).toBe(200);
    expect(held.appends()).toBe(1);
  });
});
