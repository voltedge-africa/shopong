// The phone's signed client (story 3.4): a fresh signed request per call, the failure kinds the app acts on, and a
// timeout. The network is a fake that records what was sent, so each signature is checked against the same bytes.
import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import { isRequestNonce, requestBytes, verifyRequestSignature } from "@shopong/community";
import { webCryptoSha512, type EventEnvelope } from "@shopong/events";
import type { Did, Signature } from "@shopong/ports";
import { describe, expect, it } from "vite-plus/test";
import { planFailureMessage } from "./route";
import { createNodeClient, failureOf, type FetchLike } from "./nodeClient";

const KEY = "a".repeat(64);
const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

type Sent = { url: string; method: string; headers: Record<string, string>; body?: string };

async function phoneWith(
  reply: (sent: Sent) => { status: number; body: unknown } | "throw" | "hang",
) {
  const auth = new IsoUcanCapabilityAuth();
  const did = await auth.createIdentity();
  const sent: Sent[] = [];
  const fetchFake: FetchLike = (url, init) => {
    const record: Sent = { url, method: init.method, headers: init.headers, body: init.body };
    sent.push(record);
    const answer = reply(record);
    if (answer === "throw") return Promise.reject(new TypeError("Network request failed"));
    if (answer === "hang") {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }
    return Promise.resolve({ status: answer.status, json: async () => answer.body });
  };
  const client = createNodeClient({
    baseUrl: "https://node.example",
    auth,
    did,
    fetch: fetchFake,
    randomBytes,
    timeoutMs: 25,
  });
  return { auth, did, client, sent };
}

const event = { v: 1, type: "member.joined", space: KEY } as unknown as EventEnvelope;

describe("the phone's signed client", () => {
  it("signs every call with a fresh one-time number, over the exact body it sends", async () => {
    const phone = await phoneWith(() => ({ status: 200, body: { id: "x", duplicate: false } }));
    await phone.client.postEvent(KEY, event);
    await phone.client.postEvent(KEY, event);
    const [first, second] = phone.sent;
    expect(first!.body).toBe(second!.body);
    expect(first!.headers["x-ocn-nonce"]).not.toBe(second!.headers["x-ocn-nonce"]);
    expect(isRequestNonce(first!.headers["x-ocn-nonce"]!)).toBe(true);
    // The signature verifies over the same bytes the Node rebuilds: method, path, body hash, nonce, time, actor.
    const parts = {
      method: first!.method,
      path: `/spaces/${KEY}/events`,
      body: first!.body!,
      nonce: first!.headers["x-ocn-nonce"]!,
      time: Number(first!.headers["x-ocn-time"]),
      actor: phone.did,
    };
    expect(
      await verifyRequestSignature(
        phone.auth,
        parts,
        first!.headers["x-ocn-signature"] as never,
        webCryptoSha512,
      ),
    ).toBe(true);
    expect(await requestBytes(parts, webCryptoSha512)).toBeInstanceOf(Uint8Array);
  });

  it("includes the query string in what is signed, so the Node sees the same path", async () => {
    const phone = await phoneWith(() => ({
      status: 200,
      body: { events: [], next: "", more: false, behind: false },
    }));
    await phone.client.pull(KEY, "abc", 50);
    expect(phone.sent[0]!.url).toBe(`https://node.example/spaces/${KEY}/events?after=abc&limit=50`);
    expect(phone.sent[0]!.method).toBe("GET");
  });

  it("answers ok with the Node's values", async () => {
    const phone = await phoneWith(() => ({ status: 200, body: { id: "e1", duplicate: true } }));
    expect(await phone.client.postEvent(KEY, event)).toEqual({
      ok: true,
      value: { id: "e1", duplicate: true },
    });
  });

  it("calls no answer, a timeout and a server error offline: keep and retry", async () => {
    const thrown = await phoneWith(() => "throw");
    const a = await thrown.client.postEvent(KEY, event);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.failure.kind).toBe("offline");
    const hung = await phoneWith(() => "hang");
    const b = await hung.client.postEvent(KEY, event);
    if (!b.ok) expect(b.failure.kind).toBe("offline");
    else throw new Error("a timeout must not succeed");
    const broken = await phoneWith(() => ({ status: 503, body: {} }));
    const c = await broken.client.postEvent(KEY, event);
    if (!c.ok) expect(c.failure.kind).toBe("offline");
  });

  it("calls a clock refusal its own kind, so it is retried and never parked (review P7)", () => {
    expect(failureOf(401, { problem: "clock_skew", reason: "x" }).kind).toBe("clock");
    expect(failureOf(401, { problem: "unsigned", reason: "x" }).kind).toBe("refused");
  });

  it("calls a not-yet-admitted writer and too many requests waiting: keep and retry", () => {
    expect(failureOf(403, { problem: "not_writable", reason: "x" }).kind).toBe("waiting");
    expect(failureOf(429, { problem: "busy", reason: "x" }).kind).toBe("waiting");
  });

  it("calls any other 4xx refused, and keeps the Node's plain reason", () => {
    const failure = failureOf(403, {
      problem: "not_member",
      reason: "Only a member of the community can read it.",
    });
    expect(failure).toEqual({
      kind: "refused",
      status: 403,
      problem: "not_member",
      reason: "Only a member of the community can read it.",
    });
    expect(failureOf(400, { problem: "invalid_event" }).kind).toBe("refused");
    expect(failureOf(401, "<html>").kind).toBe("refused");
  });

  it("gives a refused write a plain reason the Node sent, and a fallback when there is none", async () => {
    const phone = await phoneWith(() => ({
      status: 403,
      body: {
        problem: "community_limit",
        reason:
          "You already have three communities on this Node, which is the most one person can make.",
      },
    }));
    const made = await phone.client.createCommunity(KEY);
    if (made.ok) throw new Error("should be refused");
    expect(made.failure).toMatchObject({ kind: "refused", problem: "community_limit" });
    expect(failureOf(404, {}).kind).toBe("refused");
    expect(failureOf(404, {})).toMatchObject({ reason: "The OCN Node did not accept it." });
  });
});

describe("the phone's pool call (story 4.6)", () => {
  const poolBody = {
    currency: "ZAR",
    total: { minor: "50000", text: "The pool holds R500.00." },
    target: null,
    you: {
      minor: "0",
      text: "You have paid R0.00",
      share: null,
      shareText: null,
      status: { kind: "no_target", label: "No target yet" },
    },
    members: [],
    flags: [],
    requestId: "r1",
  };

  it("sends a signed GET for the community's pool, with no body", async () => {
    const phone = await phoneWith(() => ({ status: 200, body: poolBody }));
    await phone.client.pool(KEY);
    const [sent] = phone.sent;
    expect(sent!.method).toBe("GET");
    expect(sent!.url).toBe(`https://node.example/communities/${KEY}/pool`);
    expect(sent!.body).toBeUndefined();
    expect(sent!.headers["x-ocn-signature"]).toBeDefined();
  });

  it("answers ok with the Node's figures", async () => {
    const phone = await phoneWith(() => ({ status: 200, body: poolBody }));
    const reply = await phone.client.pool(KEY);
    expect(reply.ok).toBe(true);
    if (reply.ok) expect(reply.value.total.text).toBe("The pool holds R500.00.");
  });

  it("reads the books being unreadable as a plain refusal, not as an unreachable Node", async () => {
    const phone = await phoneWith(() => ({
      status: 503,
      body: { problem: "books_unavailable", reason: "The books can't be read right now." },
    }));
    const reply = await phone.client.pool(KEY);
    expect(reply.ok).toBe(false);
    if (!reply.ok) {
      expect(reply.failure.kind).toBe("refused");
      expect(reply.failure.reason).toBe("The books can't be read right now.");
    }
  });

  it("treats a timeout as the Node being unreachable", async () => {
    const phone = await phoneWith(() => "hang");
    const reply = await phone.client.pool(KEY);
    expect(reply.ok).toBe(false);
    if (!reply.ok) expect(reply.failure.kind).toBe("offline");
  });
});

describe("the Node's record-off answer (triage 9)", () => {
  it("reads a 503 record_off as the Node's own plain reason, not as an unreachable Node", async () => {
    const phone = await phoneWith(() => ({
      status: 503,
      body: { problem: "record_off", reason: "The Node record is not running." },
    }));
    const reply = await phone.client.pool(KEY);
    expect(reply.ok).toBe(false);
    if (!reply.ok) {
      expect(reply.failure.kind).toBe("refused");
      expect(reply.failure.reason).toBe("The Node record is not running.");
    }
  });
});

describe("the pledge payment calls (story 4.3)", () => {
  const PLEDGE = "cd".repeat(64);

  it("sends only the community and the pledge's event id, never an amount", async () => {
    const phone = await phoneWith(() => ({
      status: 200,
      body: {
        bankPath: "/simulated-bank/pir_1",
        status: "pending",
        amountMinor: 15000,
        recorded: false,
      },
    }));
    const reply = await phone.client.payPledge(KEY, PLEDGE);
    expect(reply.ok).toBe(true);
    const sent = phone.sent[0]!;
    expect(sent.url).toBe("https://node.example/payments/requests");
    expect(JSON.parse(sent.body!)).toEqual({ community: KEY, pledge: PLEDGE });
    expect(reply.ok && reply.value.bankPath).toBe("/simulated-bank/pir_1");
  });

  it("signs the status read over its query, so the Node sees the same path", async () => {
    const phone = await phoneWith(() => ({
      status: 200,
      body: { status: "cancelled", amountMinor: 15000 },
    }));
    const reply = await phone.client.paymentStatus(KEY, PLEDGE);
    expect(reply).toMatchObject({ ok: true, value: { status: "cancelled", amountMinor: 15000 } });
    const sent = phone.sent[0]!;
    expect(sent.url).toBe(`https://node.example/payments/status?community=${KEY}&pledge=${PLEDGE}`);
    const parts = {
      method: "GET",
      path: `/payments/status?community=${KEY}&pledge=${PLEDGE}`,
      body: "",
      nonce: sent.headers["x-ocn-nonce"]!,
      time: Number(sent.headers["x-ocn-time"]),
      actor: sent.headers["x-ocn-actor"] as Did,
    };
    expect(
      await verifyRequestSignature(
        phone.auth,
        parts,
        sent.headers["x-ocn-signature"] as Signature,
        webCryptoSha512,
      ),
    ).toBe(true);
  });

  it("reports a refused pay request as a plain refusal, not as offline", async () => {
    const phone = await phoneWith(() => ({
      status: 404,
      body: { problem: "unknown_pledge", reason: "The Node does not have that pledge yet." },
    }));
    const reply = await phone.client.payPledge(KEY, PLEDGE);
    expect(reply).toMatchObject({
      ok: false,
      failure: { kind: "refused", reason: "The Node does not have that pledge yet." },
    });
  });
});

describe("route planning on the Node (story 7.4)", () => {
  const FP = "c".repeat(128);
  const answer = {
    fingerprint: FP,
    origin: { id: "a".repeat(64), label: "Mamelodi Wholesale depot", area: "Mamelodi" },
    destination: { id: "b".repeat(64), label: "Orlando community hall", area: "Soweto" },
    costing: "auto",
    distanceMeters: 12_400,
    durationSeconds: 1_500,
    tileRelease: "straight-line",
    straightLine: true,
    polyline6: "_p~iF~ps|U",
    sentences: ["Route from A to B.", "About 12.4 km, about 25 minutes by car.", "Straight line."],
    community: KEY,
    requestId: "r1",
  };

  it("sends a signed plan to the Node and reads the summary, the line and the sentences", async () => {
    const phone = await phoneWith(() => ({ status: 200, body: answer }));
    const reply = await phone.client.planRoute(KEY, {
      order: "o1",
      origin: "a".repeat(64),
      destination: "b".repeat(64),
    });
    expect(reply.ok).toBe(true);
    if (reply.ok) expect(reply.value.sentences).toHaveLength(3);
    const [sent] = phone.sent;
    expect(sent!.method).toBe("POST");
    expect(sent!.url).toBe(`https://node.example/communities/${KEY}/routes`);
    expect(JSON.parse(sent!.body!)).toEqual({
      order: "o1",
      origin: "a".repeat(64),
      destination: "b".repeat(64),
    });
    const parts = {
      method: "POST",
      path: `/communities/${KEY}/routes`,
      body: sent!.body!,
      nonce: sent!.headers["x-ocn-nonce"]!,
      time: Number(sent!.headers["x-ocn-time"]),
      actor: phone.did,
    };
    expect(
      await verifyRequestSignature(
        phone.auth,
        parts,
        sent!.headers["x-ocn-signature"] as Signature,
        webCryptoSha512,
      ),
    ).toBe(true);
    expect(isRequestNonce(parts.nonce)).toBe(true);
  });

  it("reads a planned route by its fingerprint from a query value", async () => {
    const phone = await phoneWith(() => ({ status: 200, body: answer }));
    const reply = await phone.client.route(KEY, "o1", FP);
    expect(reply.ok).toBe(true);
    expect(phone.sent[0]!.url).toBe(
      `https://node.example/communities/${KEY}/route?order=o1&fingerprint=${FP}`,
    );
  });

  it("says a plan needs a connection when the Node cannot be reached", async () => {
    const phone = await phoneWith(() => "throw");
    const reply = await phone.client.planRoute(KEY, {
      order: "o1",
      origin: "a".repeat(64),
      destination: "b".repeat(64),
    });
    expect(reply.ok).toBe(false);
    if (!reply.ok)
      expect(planFailureMessage(reply.failure)).toBe("Planning a route needs a connection.");
  });

  it("shows the Node's plain refusal for a plain member", async () => {
    const phone = await phoneWith(() => ({
      status: 403,
      body: {
        problem: "not_permitted",
        reason: "Only the treasurer or the driver can plan a route.",
      },
    }));
    const reply = await phone.client.planRoute(KEY, {
      order: "o1",
      origin: "a".repeat(64),
      destination: "b".repeat(64),
    });
    if (reply.ok) throw new Error("expected a refusal");
    expect(planFailureMessage(reply.failure)).toBe(
      "Only the treasurer or the driver can plan a route.",
    );
  });
});

describe("the phone's payout calls (story 4.7)", () => {
  const PAYMENT = "cd".repeat(64);
  const BANK = {
    name: "Makro Soweto",
    bankId: "fnb",
    accountNumber: "1234567890",
    accountType: "current" as const,
  };

  it("sends the community and the payment id as a signed POST, and answers with the Node's plain words", async () => {
    const phone = await phoneWith(() => ({
      status: 200,
      body: {
        simulated: true,
        status: "pending",
        reason: "Payment sent to Makro Soweto (simulated).",
        payout: PAYMENT,
      },
    }));
    const reply = await phone.client.payOut(KEY, PAYMENT);
    expect(reply).toMatchObject({
      ok: true,
      value: { reason: "Payment sent to Makro Soweto (simulated)." },
    });
    const [sent] = phone.sent;
    expect(sent?.url).toBe("https://node.example/payouts");
    expect(sent?.method).toBe("POST");
    expect(JSON.parse(sent?.body ?? "{}")).toEqual({ community: KEY, payout: PAYMENT });
  });

  it("gives the Node's refusal its plain reason, so a person can act on it", async () => {
    const phone = await phoneWith(() => ({
      status: 422,
      body: { problem: "not_enough_approvals", reason: "Two people must approve this payment." },
    }));
    const reply = await phone.client.payOut(KEY, PAYMENT);
    expect(reply).toMatchObject({
      ok: false,
      failure: {
        kind: "refused",
        problem: "not_enough_approvals",
        reason: "Two people must approve this payment.",
      },
    });
  });

  it("saves a supplier's bank details to the Node, and says so without sending them back", async () => {
    const phone = await phoneWith(() => ({
      status: 200,
      body: { saved: true, supplier: "Makro Soweto" },
    }));
    const reply = await phone.client.saveSupplierBank(KEY, "Makro Soweto", BANK);
    expect(reply).toMatchObject({ ok: true, value: { saved: true } });
    const [sent] = phone.sent;
    expect(sent?.url).toBe("https://node.example/suppliers/bank");
    expect(JSON.parse(sent?.body ?? "{}")).toMatchObject({
      community: KEY,
      supplier: "Makro Soweto",
      ...BANK,
    });
  });
});
