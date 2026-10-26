// `POST /payments/requests` and `GET /payments/status` (story 4.3): a member pays their own current pledge through the
// simulated bank. The phone sends only the pledge's event id; the Node checks the record and the caller, writes the
// Node's `payment.requested` into the record as the creator, and only then creates the request. Rows marked [S-4.3]
// are security rows. Real injection (`app.inject`), a signed caller on each request, the simulated Stitch in memory or
// on a state file, and a fake replica hub holding the view a pledge is read from.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import { createSimulatedStitch, type SimulatedStitch } from "@shopong/adapter-stitch-sim";
import {
  PLEDGE_MESSAGES,
  pledgeEventKey,
  pledgeJson,
  pledgeKey,
  signRequest,
  type RequestParts,
  type StoredPledge,
} from "@shopong/community";
import { webCryptoSha512 } from "@shopong/events";
import {
  err,
  type CapabilityAuth,
  type Did,
  type JsonValue,
  type ViewReader,
} from "@shopong/ports";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { buildApp } from "./app.ts";
import { nodeHmacSha512 } from "./commitments.ts";
import { createLogger, type LogSink } from "./logger.ts";
import {
  PAYMENT_WINDOW_MS,
  payerCommitmentOf,
  PAYMENT_REQUEST_MESSAGES,
  type PaymentHub,
  type PaymentRequestOptions,
} from "./payment-request-route.ts";
import { phone, randomHex, T0, type Phone } from "./testing/community.ts";

const folders: string[] = [];
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

const COMMUNITY = "ab".repeat(32);
const OTHER_COMMUNITY = "cd".repeat(32);
/** The Node's did:key: the `by` of every event it writes. The record's creator writes those events as the actor. */
const NODE_IDENTITY = "did:key:z6MkfrQ7y7N9mWrVHgqZ6nqvpjhiWqwCfsZUYqL4pkoKJ2zL" as Did;
const OWNER = "did:key:z6MkmtmqQWNzwamfa7QWkNU3Sk2qHpuXK4VrfMXXqVouVZtL" as Did;
const SECRET = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff);
const DAY = 24 * 60 * 60 * 1000;

/**
 * A replica hub with one view per community, a membership list and a log of the events the Node wrote. `rejectWith`
 * makes the record refuse the next event (as `apply` does: a `rejected/<id>` marker), and `recordable` makes the
 * record refuse the write itself.
 */
class FakeHub implements PaymentHub {
  readonly members = new Set<string>();
  readonly views = new Map<string, Map<string, JsonValue>>([
    [COMMUNITY, new Map()],
    [OTHER_COMMUNITY, new Map()],
  ]);
  readonly written: { id: string; type: string; community: string; payload: unknown }[] = [];
  readonly seen = new Set<string>();
  recordable = true;
  rejectWith: string | undefined;

  registrationOf(key: string) {
    return this.views.has(key) ? { spaceKey: key, creator: OWNER } : undefined;
  }
  async isMember(did: Did, key: string) {
    return this.views.has(key) ? this.members.has(did) : undefined;
  }
  async indexedView(key: string): Promise<ViewReader | undefined> {
    const data = this.views.get(key);
    if (data === undefined) return undefined;
    return {
      async get(k: string) {
        return data.get(k);
      },
      async list(prefix: string) {
        return [...data.entries()]
          .filter(([k]) => k.startsWith(prefix))
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([key, value]) => ({ key, value }));
      },
    };
  }
  /** As `ReplicaHub.mirror`: appended through the creator's replica; a kept event id is kept once; a refusal is reported. */
  async mirror(
    key: string,
    event: { type: string; actor: string; payload: unknown; nonce: string },
  ) {
    if (!this.views.has(key) || !this.recordable) return undefined;
    if (event.actor !== OWNER)
      throw new Error("the Node writes through the creator's replica only");
    const id = `${event.type}:${key}:${event.nonce}`;
    if (this.seen.has(id)) return { id, duplicate: true, ...this.refusalOf(key, id) };
    this.seen.add(id);
    this.written.push({ id, type: event.type, community: key, payload: event.payload });
    if (this.rejectWith !== undefined) {
      this.views.get(key)!.set(`rejected/${id}`, { type: event.type, reason: this.rejectWith });
    }
    return { id, duplicate: false, ...this.refusalOf(key, id) };
  }
  private refusalOf(key: string, id: string) {
    const marker = this.views.get(key)!.get(`rejected/${id}`) as { reason?: string } | undefined;
    return marker === undefined ? {} : { rejected: marker.reason };
  }
}

interface Harness {
  app: ReturnType<typeof buildApp>;
  hub: FakeHub;
  simulated: SimulatedStitch;
  now: { value: number };
  logs: string[];
  bank: { down: boolean };
  alice: Phone;
  bob: Phone;
  stateFile: string;
}

async function harness(options: { payments?: boolean; stateFile?: string } = {}): Promise<Harness> {
  const folder = mkdtempSync(join(tmpdir(), "ocn-pay-route-"));
  folders.push(folder);
  const stateFile = options.stateFile ?? join(folder, "payments-simulated.json");
  const now = { value: T0 };
  const logs: string[] = [];
  const sink: LogSink = { write: (line) => void logs.push(line) };
  const auth = new IsoUcanCapabilityAuth();
  const simulated = createSimulatedStitch({
    webhookKey: new Uint8Array(32).map((_, i) => (i * 13 + 5) & 0xff),
    hmac: nodeHmacSha512,
    clock: { now: () => now.value },
    stateFile,
    log: (line) => logs.push(line),
  });
  // The bank can be made to fail the next request creation (a bank that is down), and nothing else.
  const bank = { down: false };
  const bankPayIn = new Proxy(simulated.payIn, {
    get(target, property) {
      if (property === "createRequest") {
        return async (input: unknown) =>
          bank.down
            ? err("invalid_request", "the bank is not answering")
            : (target.createRequest as (i: unknown) => unknown)(input);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function"
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  });
  const hub = new FakeHub();
  const alice = await phone();
  const bob = await phone();
  hub.members.add(alice.did);
  hub.members.add(bob.did);
  const routeOptions: PaymentRequestOptions = {
    auth: auth as CapabilityAuth,
    clock: () => now.value,
    payments: options.payments === false ? undefined : { ...simulated, payIn: bankPayIn as never },
    hub,
    payerCommitment: async (community, did) =>
      payerCommitmentOf(SECRET, community, did, nodeHmacSha512),
    nodeIdentity: NODE_IDENTITY,
  };
  const app = buildApp({
    logger: createLogger({ level: "info", sink }),
    version: "test",
    components: [],
    auth,
    paymentRequests: routeOptions,
  });
  await app.ready();
  return { app, hub, simulated, now, logs, bank, alice, bob, stateFile };
}

/** A pledge as `apply` records it (the same JSON), made by `who` at `claimedAt` for `minor` cents. */
function recordPledge(
  h: Harness,
  who: Phone,
  minor: number,
  eventId: string,
  claimedAt = h.now.value,
  community = COMMUNITY,
) {
  const fields = { order: "March groceries", member: who.did, minor };
  const view = h.hub.views.get(community)!;
  view.set(pledgeEventKey(eventId), {
    ...pledgeJson(eventId, fields, claimedAt),
    order: fields.order,
  } as JsonValue);
  view.set(pledgeKey(fields.order, who.did), pledgeJson(eventId, fields, claimedAt) as JsonValue);
}

const PLEDGE = "cd".repeat(64);
const SECOND = "ef".repeat(64);
const THIRD = "12".repeat(64);

interface Signed {
  headers: Record<string, string>;
  method: string;
  url: string;
  body: string;
}

/** Signs a request as `who` at the Node's clock, so the one-time number and time are the caller's. */
async function sign(
  h: Harness,
  who: Phone,
  method: "GET" | "POST",
  url: string,
  body?: unknown,
): Promise<Signed> {
  const text = body === undefined ? "" : JSON.stringify(body);
  const parts: RequestParts = {
    method,
    path: url,
    body: text,
    nonce: randomHex(16),
    time: h.now.value,
    actor: who.did,
  };
  const signed = await signRequest(who.auth, parts, webCryptoSha512);
  if (!signed.ok) throw new Error(signed.error.message);
  return {
    headers: {
      ...(signed.value as unknown as Record<string, string>),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    method,
    url,
    body: text,
  };
}

async function send(h: Harness, request: Signed) {
  const res = await h.app.inject({
    method: request.method as "GET" | "POST",
    url: request.url,
    headers: request.headers,
    ...(request.body === "" ? {} : { payload: request.body }),
  });
  return { status: res.statusCode, json: res.json() as Record<string, unknown> };
}

const payBody = (pledge = PLEDGE, community = COMMUNITY) => ({ community, pledge });
const statusUrl = (pledge = PLEDGE, community = COMMUNITY) =>
  `/payments/status?community=${community}&pledge=${pledge}`;
const requestsOf = (h: Harness) => h.hub.written.filter((w) => w.type === "payment.requested");

describe("paying a pledge (story 4.3)", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await harness();
    recordPledge(h, h.alice, 15000, PLEDGE);
  });

  it("creates one request keyed by the pledge event id and returns the bank page", async () => {
    const reply = await send(h, await sign(h, h.alice, "POST", "/payments/requests", payBody()));
    expect(reply.status).toBe(200);
    expect(reply.json).toMatchObject({
      simulated: true,
      status: "pending",
      amountMinor: 15000,
      recorded: true,
    });
    expect(String(reply.json.bankPath)).toMatch(/^\/simulated-bank\/pir_[0-9a-f]{32}$/);
    const request = await h.simulated.payIn.findRequest(PLEDGE as never);
    expect(request?.externalReference).toBe(PLEDGE);
    expect(request?.amount).toEqual({ currency: "ZAR", minor: 15000 });
  });

  it("[S-4.3] the bank's expiry is the Node's clock plus the window, never the event's time", async () => {
    // A pledge that claims a year ahead must not keep the request payable for a year (review item 1).
    recordPledge(h, h.bob, 15000, THIRD, T0 + 365 * DAY);
    const reply = await send(h, await sign(h, h.bob, "POST", "/payments/requests", payBody(THIRD)));
    expect(reply.status).toBe(200);
    expect(reply.json.expiresAt).toBe(T0 + PAYMENT_WINDOW_MS);
    expect((await h.simulated.payIn.findRequest(THIRD as never))?.expireAt).toBe(
      T0 + PAYMENT_WINDOW_MS,
    );
  });

  it("names the payer as OCN- plus 8 hex of the member's commitment, never a name or a DID", async () => {
    const reply = await send(h, await sign(h, h.alice, "POST", "/payments/requests", payBody()));
    const mac = await payerCommitmentOf(SECRET, COMMUNITY, h.alice.did, nodeHmacSha512);
    expect(reply.json.payerReference).toBe(`OCN-${mac.slice(0, 8)}`);
    expect(JSON.stringify(reply.json)).not.toContain(h.alice.did);
    expect(JSON.stringify(h.logs)).not.toContain(mac);
  });

  it("[S-4.3] gives the same member a different payer reference in a second community", async () => {
    // Review item 3: the commitment is keyed by community, so the same DID is not the same reference everywhere.
    recordPledge(h, h.alice, 15000, THIRD, T0, OTHER_COMMUNITY);
    const first = await send(h, await sign(h, h.alice, "POST", "/payments/requests", payBody()));
    const second = await send(
      h,
      await sign(h, h.alice, "POST", "/payments/requests", payBody(THIRD, OTHER_COMMUNITY)),
    );
    expect(second.status).toBe(200);
    expect(second.json.payerReference).not.toBe(first.json.payerReference);
  });

  it("answers a double tap with the same request, and writes the record event once", async () => {
    const first = await send(h, await sign(h, h.alice, "POST", "/payments/requests", payBody()));
    const second = await send(h, await sign(h, h.alice, "POST", "/payments/requests", payBody()));
    expect(second.status).toBe(200);
    expect(second.json.bankPath).toBe(first.json.bankPath);
    expect(requestsOf(h)).toHaveLength(1);
  });

  it("[S-4.3] handles two taps sent at once: one bank request, one record event", async () => {
    const [a, b] = await Promise.all([
      send(h, await sign(h, h.alice, "POST", "/payments/requests", payBody())),
      send(h, await sign(h, h.alice, "POST", "/payments/requests", payBody())),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.json.bankPath).toBe(a.json.bankPath);
    expect(requestsOf(h)).toHaveLength(1);
    expect(await h.simulated.payIn.findRequest(PLEDGE as never)).toBeDefined();
  });

  it("[S-4.3] one payment.requested exists in the record after Pay, signed by the Node's identity", async () => {
    const reply = await send(h, await sign(h, h.alice, "POST", "/payments/requests", payBody()));
    expect(reply.json.recorded).toBe(true);
    expect(requestsOf(h)).toHaveLength(1);
    expect(requestsOf(h)[0]!.payload).toEqual({
      direction: "in",
      pledgeEvent: PLEDGE,
      amount: { currency: "ZAR", minor: 15000 },
      by: NODE_IDENTITY,
    });
  });

  it("[S-4.3] refuses Pay, and creates nothing, when the record cannot take the Node's event", async () => {
    h.hub.recordable = false;
    const reply = await send(h, await sign(h, h.alice, "POST", "/payments/requests", payBody()));
    expect(reply.status).toBe(503);
    expect(await h.simulated.payIn.findRequest(PLEDGE as never)).toBeUndefined();
  });

  it("[S-4.3] refuses Pay, and creates no bank request, when the record refuses the Node's payment.requested", async () => {
    // Review item 7: the record's verdict is checked before the bank is asked.
    h.hub.rejectWith = PLEDGE_MESSAGES.not_member;
    const reply = await send(h, await sign(h, h.alice, "POST", "/payments/requests", payBody()));
    expect(reply.status).toBe(422);
    expect(reply.json.problem).toBe("record_refused");
    expect(reply.json.reason).toBe(PLEDGE_MESSAGES.not_member);
    expect(await h.simulated.payIn.findRequest(PLEDGE as never)).toBeUndefined();
  });

  it("[S-4.3] a bank failure after a good record write is said plainly, and a retry reuses the same record event", async () => {
    h.bank.down = true;
    const failed = await send(h, await sign(h, h.alice, "POST", "/payments/requests", payBody()));
    expect(failed.status).toBe(422);
    expect(failed.json.problem).toBe("bank_unavailable");
    expect(failed.json.recorded).toBe(true);
    expect(requestsOf(h)).toHaveLength(1);
    expect(await h.simulated.payIn.findRequest(PLEDGE as never)).toBeUndefined();
    h.bank.down = false;
    const retried = await send(h, await sign(h, h.alice, "POST", "/payments/requests", payBody()));
    expect(retried.status).toBe(200);
    expect(requestsOf(h)).toHaveLength(1);
    expect(await h.simulated.payIn.findRequest(PLEDGE as never)).toBeDefined();
  });

  it("[S-4.3] refuses a pledge that is not the member's current one, and gives no second bank request", async () => {
    // Review item 2: Pay the first pledge after pledging again.
    const first = await send(h, await sign(h, h.alice, "POST", "/payments/requests", payBody()));
    expect(first.status).toBe(200);
    recordPledge(h, h.alice, 15000, SECOND);
    const replay = await send(
      h,
      await sign(h, h.alice, "POST", "/payments/requests", payBody(PLEDGE)),
    );
    expect(replay.status).toBe(409);
    expect(replay.json.reason).toBe(PAYMENT_REQUEST_MESSAGES.not_current);
    expect(requestsOf(h)).toHaveLength(1);
    expect(await h.simulated.payIn.findRequest(SECOND as never)).toBeUndefined();
  });

  it("[S-4.3] refuses a second live request while one is pending for the same member and order", async () => {
    await send(h, await sign(h, h.alice, "POST", "/payments/requests", payBody()));
    recordPledge(h, h.alice, 15000, SECOND);
    const second = await send(
      h,
      await sign(h, h.alice, "POST", "/payments/requests", payBody(SECOND)),
    );
    expect(second.status).toBe(409);
    expect(second.json.reason).toBe(PAYMENT_REQUEST_MESSAGES.live_elsewhere);
    expect(await h.simulated.payIn.findRequest(SECOND as never)).toBeUndefined();
  });

  it("pays again after the bank page was cancelled: a new pledge gets a new request, the old one is not revived", async () => {
    const first = await send(h, await sign(h, h.alice, "POST", "/payments/requests", payBody()));
    const request = await h.simulated.payIn.findRequest(PLEDGE as never);
    await h.simulated.payIn.actAsPayer(request!.id, "cancelled");
    recordPledge(h, h.alice, 15000, SECOND);
    const again = await send(
      h,
      await sign(h, h.alice, "POST", "/payments/requests", payBody(SECOND)),
    );
    expect(again.status).toBe(200);
    expect(again.json.bankPath).not.toBe(first.json.bankPath);
    // The cancelled pledge is no longer the current one, so a repeat for it is refused as not current.
    const oldAgain = await send(
      h,
      await sign(h, h.alice, "POST", "/payments/requests", payBody(PLEDGE)),
    );
    expect(oldAgain.status).toBe(409);
    expect(oldAgain.json.reason).toBe(PAYMENT_REQUEST_MESSAGES.not_current);
    expect(requestsOf(h)).toHaveLength(2);
  });

  it("[S-4.3] a cancelled request on the current pledge is not revived: already finished", async () => {
    await send(h, await sign(h, h.alice, "POST", "/payments/requests", payBody()));
    const request = await h.simulated.payIn.findRequest(PLEDGE as never);
    await h.simulated.payIn.actAsPayer(request!.id, "cancelled");
    const reply = await send(h, await sign(h, h.alice, "POST", "/payments/requests", payBody()));
    expect(reply.status).toBe(409);
    expect(reply.json.reason).toBe(PAYMENT_REQUEST_MESSAGES.already_finished);
    expect(requestsOf(h)).toHaveLength(1);
  });

  it("[S-4.3] an expired request is not revived by a repeat call", async () => {
    await send(h, await sign(h, h.alice, "POST", "/payments/requests", payBody()));
    h.now.value += PAYMENT_WINDOW_MS + 1;
    const reply = await send(h, await sign(h, h.alice, "POST", "/payments/requests", payBody()));
    expect(reply.status).toBe(409);
    expect(reply.json.reason).toBe(PAYMENT_REQUEST_MESSAGES.window_closed);
  });

  it("the status of an expired request says expired, and the window is closed", async () => {
    await send(h, await sign(h, h.alice, "POST", "/payments/requests", payBody()));
    h.now.value += PAYMENT_WINDOW_MS + 1;
    const reply = await send(h, await sign(h, h.alice, "GET", statusUrl()));
    expect(reply.json).toMatchObject({ status: "expired", windowOpen: false });
  });

  it("the status of a pledge with no request, past its window, says none and the window is closed", async () => {
    h.now.value += PAYMENT_WINDOW_MS + 1;
    const reply = await send(h, await sign(h, h.alice, "GET", statusUrl()));
    expect(reply.json).toMatchObject({ status: "none", windowOpen: false });
  });

  it("[S-4.3] refuses a pledge that has run out, and creates nothing", async () => {
    h.now.value += PAYMENT_WINDOW_MS;
    const reply = await send(h, await sign(h, h.alice, "POST", "/payments/requests", payBody()));
    expect(reply.status).toBe(409);
    expect(reply.json.reason).toBe(PAYMENT_REQUEST_MESSAGES.window_closed);
    expect(await h.simulated.payIn.findRequest(PLEDGE as never)).toBeUndefined();
  });

  it("[S-4.3] refuses an amount sent by the phone, and creates nothing", async () => {
    const reply = await send(
      h,
      await sign(h, h.alice, "POST", "/payments/requests", {
        ...payBody(),
        amount: { currency: "ZAR", minor: 1 },
      }),
    );
    expect(reply.status).toBe(400);
    expect(reply.json.reason).toBe("The amount must match your pledge.");
    expect(await h.simulated.payIn.findRequest(PLEDGE as never)).toBeUndefined();
  });

  it("[S-4.3] refuses a phone that names its own payment id or bank address, and creates nothing", async () => {
    const reply = await send(
      h,
      await sign(h, h.alice, "POST", "/payments/requests", {
        ...payBody(),
        paymentId: "pir_x",
        url: "https://evil",
      }),
    );
    expect(reply.status).toBe(400);
    expect(await h.simulated.payIn.findRequest(PLEDGE as never)).toBeUndefined();
  });

  it("[S-4.3] refuses someone else's pledge (wrong actor), and creates nothing", async () => {
    const reply = await send(h, await sign(h, h.bob, "POST", "/payments/requests", payBody()));
    expect(reply.status).toBe(403);
    expect(reply.json.reason).toBe(PLEDGE_MESSAGES.pay_not_yours);
    expect(await h.simulated.payIn.findRequest(PLEDGE as never)).toBeUndefined();
  });

  it("[S-4.3] refuses a caller who is not a member, with the plain role sentence, and creates nothing", async () => {
    const stranger = await phone();
    const reply = await send(h, await sign(h, stranger, "POST", "/payments/requests", payBody()));
    expect(reply.status).toBe(403);
    expect(reply.json.reason).toBe(PLEDGE_MESSAGES.pay_no_role);
    expect(await h.simulated.payIn.findRequest(PLEDGE as never)).toBeUndefined();
  });

  it("[S-4.3] refuses a payment request for a pledge by a member who has since been removed, and creates nothing", async () => {
    recordPledge(h, h.bob, 15000, SECOND);
    h.hub.members.delete(h.bob.did);
    const reply = await send(
      h,
      await sign(h, h.bob, "POST", "/payments/requests", payBody(SECOND)),
    );
    expect(reply.status).toBe(403);
    expect(reply.json.reason).toBe(PLEDGE_MESSAGES.pay_no_role);
    expect(await h.simulated.payIn.findRequest(SECOND as never)).toBeUndefined();
    expect(requestsOf(h)).toHaveLength(0);
  });

  it.each([
    ["under R1.00", 99, PLEDGE_MESSAGES.too_small],
    ["over R3,000.00", 300_001, PLEDGE_MESSAGES.too_big],
  ] as const)(
    "[S-4.3] refuses a pledge %s, and creates nothing",
    async (_name, minor, sentence) => {
      recordPledge(h, h.alice, minor, THIRD);
      const reply = await send(
        h,
        await sign(h, h.alice, "POST", "/payments/requests", payBody(THIRD)),
      );
      expect(reply.status).toBe(422);
      expect(reply.json.reason).toBe(sentence);
      expect(await h.simulated.payIn.findRequest(THIRD as never)).toBeUndefined();
    },
  );

  it("[S-4.3] refuses a replayed request (the same signed request twice), with one request made", async () => {
    const signed = await sign(h, h.alice, "POST", "/payments/requests", payBody());
    expect((await send(h, signed)).status).toBe(200);
    const replay = await send(h, signed);
    expect(replay.status).toBe(409);
    expect(replay.json.problem).toBe("replayed");
    expect(requestsOf(h)).toHaveLength(1);
  });

  it("[S-4.3] refuses an unknown pledge, and creates nothing (a pledge not yet on the Node)", async () => {
    const reply = await send(
      h,
      await sign(h, h.alice, "POST", "/payments/requests", payBody("34".repeat(64))),
    );
    expect(reply.status).toBe(404);
    expect(reply.json.reason).toBe(PAYMENT_REQUEST_MESSAGES.unknown_pledge);
    expect(requestsOf(h)).toHaveLength(0);
  });

  it("[S-4.3] counts refused calls against the rate limit, as the comment says", async () => {
    for (let i = 0; i < 60; i += 1) {
      const refused = await send(
        h,
        await sign(h, h.alice, "POST", "/payments/requests", { community: "x" }),
      );
      expect(refused.status).toBe(400);
    }
    const limited = await send(h, await sign(h, h.alice, "POST", "/payments/requests", payBody()));
    expect(limited.status).toBe(429);
    expect(requestsOf(h)).toHaveLength(0);
  });

  it("[S-4.3] rate-limits status reads too", async () => {
    for (let i = 0; i < 60; i += 1) {
      await send(h, await sign(h, h.alice, "GET", statusUrl()));
    }
    const limited = await send(h, await sign(h, h.alice, "GET", statusUrl()));
    expect(limited.status).toBe(429);
  });

  it("refuses an unsigned request", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: "/payments/requests",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(payBody()),
    });
    expect(res.statusCode).toBe(401);
  });

  it("answers 503 when payments are not switched on", async () => {
    const off = await harness({ payments: false });
    recordPledge(off, off.alice, 15000, PLEDGE);
    const reply = await send(
      off,
      await sign(off, off.alice, "POST", "/payments/requests", payBody()),
    );
    expect(reply.status).toBe(503);
  });

  it("answers the status of the member's own pledge, and turns a cancelled request into not paid", async () => {
    await send(h, await sign(h, h.alice, "POST", "/payments/requests", payBody()));
    const pending = await send(h, await sign(h, h.alice, "GET", statusUrl()));
    expect(pending.json).toMatchObject({ simulated: true, status: "pending" });
    const request = await h.simulated.payIn.findRequest(PLEDGE as never);
    await h.simulated.payIn.actAsPayer(request!.id, "cancelled");
    const after = await send(h, await sign(h, h.alice, "GET", statusUrl()));
    expect(after.json).toMatchObject({ status: "cancelled" });
  });

  it("[S-4.3] the status of someone else's pledge is refused", async () => {
    await send(h, await sign(h, h.alice, "POST", "/payments/requests", payBody()));
    const reply = await send(h, await sign(h, h.bob, "GET", statusUrl()));
    expect(reply.status).toBe(403);
  });

  it("keeps the request across a Node restart (the state file is read again)", async () => {
    await send(h, await sign(h, h.alice, "POST", "/payments/requests", payBody()));
    const before = await h.simulated.payIn.findRequest(PLEDGE as never);
    const reopened = createSimulatedStitch({
      webhookKey: new Uint8Array(32).map((_, i) => (i * 13 + 5) & 0xff),
      hmac: nodeHmacSha512,
      clock: { now: () => h.now.value },
      stateFile: h.stateFile,
    });
    expect(await reopened.payIn.findRequest(PLEDGE as never)).toEqual(before);
  });

  it("labels the payment lines it writes as simulated", async () => {
    await send(h, await sign(h, h.alice, "POST", "/payments/requests", payBody()));
    const lines = h.logs.filter(
      (l) => l.includes("payment_request") || l.includes("simulated Stitch"),
    );
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line.toLowerCase()).toContain("simulated");
  });
});

describe("pledges the record holds", () => {
  it("stores what the status route needs and no personal value", () => {
    const stored: StoredPledge = {
      order: "March groceries",
      member: OWNER,
      minor: 15000,
      event: PLEDGE,
      claimedAt: T0,
    };
    expect(Object.keys(stored).sort()).toEqual(["claimedAt", "event", "member", "minor", "order"]);
  });
});
