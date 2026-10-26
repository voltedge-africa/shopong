// Behaviour specific to the in-memory adapters, beyond what the port contracts require.
import { describe, expect, it } from "vite-plus/test";
import { encodePolyline6 } from "./routing.js";
import { decodePolyline6, expectErr, expectOk, randomEventId } from "@shopong/ports-contract";
import { money, type CapabilityToken, type Did } from "@shopong/ports";
import {
  MemoryCapabilityAuth,
  MemoryDecide,
  MemoryGeo,
  MemoryLedger,
  MemoryPayIn,
  MemoryStableRail,
  createCounterIds,
  createManualClock,
  parseDirectives,
} from "./index.js";

describe("MemoryCapabilityAuth", () => {
  const T0 = 1_000_000;

  async function chain(auth: MemoryCapabilityAuth) {
    const root = await auth.createIdentity();
    const treasurer = await auth.createIdentity();
    const agent = await auth.createIdentity();
    const space = "ocn:space/x";
    const parent = expectOk(
      await auth.issue({
        issuer: root,
        audience: treasurer,
        capabilities: [{ with: space, can: "payment/approve", ceiling: money("ZAR", 100) }],
        notBefore: T0,
        expiresAt: T0 + 1000,
      }),
    );
    return { root, treasurer, agent, space, parent };
  }

  it("verify catches amplification even when issue does not check it", async () => {
    const auth = new MemoryCapabilityAuth({ checkAttenuationOnIssue: false });
    const { root, treasurer, agent, space, parent } = await chain(auth);
    const raised = { with: space, can: "payment/approve", ceiling: money("ZAR", 500) };
    const amplified = expectOk(
      await auth.issue({
        issuer: treasurer,
        audience: agent,
        capabilities: [raised],
        notBefore: T0,
        expiresAt: T0 + 500,
        proofs: [parent],
      }),
    );
    expectErr(
      await auth.verify(amplified, { required: raised, rootIssuer: root, logTime: T0 }),
      "not_attenuated",
    );
    const outliving = expectOk(
      await auth.issue({
        issuer: treasurer,
        audience: agent,
        capabilities: [{ ...raised, ceiling: money("ZAR", 50) }],
        notBefore: T0,
        expiresAt: T0 + 5000,
        proofs: [parent],
      }),
    );
    expectErr(
      await auth.verify(outliving, {
        required: { ...raised, ceiling: money("ZAR", 50) },
        rootIssuer: root,
        logTime: T0,
      }),
      "not_attenuated",
    );
    const stolen = expectOk(
      await auth.issue({
        issuer: agent,
        audience: agent,
        capabilities: [{ ...raised, ceiling: money("ZAR", 50) }],
        notBefore: T0,
        expiresAt: T0 + 500,
        proofs: [parent],
      }),
    );
    expectErr(
      await auth.verify(stolen, {
        required: { ...raised, ceiling: money("ZAR", 50) },
        rootIssuer: root,
        logTime: T0,
      }),
      "broken_chain",
    );
  });

  it("instances sharing a keyring verify each other's tokens; others cannot", async () => {
    const keyring = new Map<Did, string>();
    const device = new MemoryCapabilityAuth({ keyring, ids: createCounterIds("device") });
    const node = new MemoryCapabilityAuth({ keyring, ids: createCounterIds("node") });
    const { root, parent } = await chain(device);
    const request = {
      required: { with: "ocn:space/x", can: "payment/approve" as const, ceiling: money("ZAR", 1) },
      rootIssuer: root,
      logTime: T0,
    };
    expectOk(await node.verify(parent, request));
    expectErr(await new MemoryCapabilityAuth().verify(parent, request), "bad_signature");
  });

  it("is deterministic given the same ids", async () => {
    const tokens: CapabilityToken[] = [];
    for (let run = 0; run < 2; run++) tokens.push((await chain(new MemoryCapabilityAuth())).parent);
    expect(tokens[0]).toBe(tokens[1]);
  });
});

describe("MemoryLedger", () => {
  it("stamps transactions from the injected clock and ids", async () => {
    const clock = createManualClock(42);
    const ledger = new MemoryLedger({ clock, ids: createCounterIds("l") });
    const { transaction } = expectOk(
      await ledger.post({
        idempotencyKey: "k1",
        description: "d",
        entries: [
          { account: "assets:a", direction: "debit", amount: money("ZAR", 1) },
          { account: "equity:b", direction: "credit", amount: money("ZAR", 1) },
        ],
      }),
    );
    expect(transaction).toMatchObject({ id: "txn_1", postedAt: 42 });
  });
});

describe("MemoryPayIn", () => {
  const input = () => ({
    amount: money("ZAR", 100_00),
    externalReference: randomEventId(),
    payerReference: "P",
    beneficiaryReference: "B",
    expireAt: createManualClock().now() + 1000,
  });

  it("expires an unpaid request when its clock passes expireAt", async () => {
    const clock = createManualClock();
    const payIn = new MemoryPayIn({ clock });
    const request = expectOk(await payIn.createRequest(input()));
    clock.advance(999);
    expect((await payIn.getRequest(request.id))?.status).toBe("pending");
    clock.advance(1);
    expect((await payIn.getRequest(request.id))?.status).toBe("expired");
  });

  it("keeps a terminal status when a later webhook disagrees", async () => {
    const payIn = new MemoryPayIn();
    const request = expectOk(await payIn.createRequest(input()));
    expectOk(await payIn.ingestWebhook(payIn.simulateWebhook(request.id, "completed")));
    const late = expectOk(
      await payIn.ingestWebhook(payIn.simulateWebhook(request.id, "cancelled")),
    );
    expect(late).toMatchObject({ applied: false, payment: { status: "completed" } });
  });

  it("refuses a signed webhook for an unknown payment", async () => {
    const payIn = new MemoryPayIn();
    expectErr(
      await payIn.ingestWebhook(payIn.simulateWebhook("pay_404", "completed")),
      "unknown_payment",
    );
  });
});

describe("MemoryStableRail", () => {
  it("stays submitted until read, then confirms", async () => {
    const rail = new MemoryStableRail({ confirmAfterReads: 2 });
    const a = await rail.openWallet("a");
    const b = await rail.openWallet("b");
    await rail.mint(a.address, "10");
    const t = expectOk(
      await rail.transfer({
        fromWalletId: a.id,
        to: b.address,
        amount: "4",
        idempotencyKey: randomEventId(),
      }),
    );
    expect((await rail.getTransfer(t.id))?.status).toBe("submitted");
    expect((await rail.getTransfer(t.id))?.status).toBe("submitted");
    expect((await rail.getTransfer(t.id))?.status).toBe("confirmed");
    expect(await rail.balance(b.address)).toBe("4");
  });

  it("counts pending outgoing transfers against the balance", async () => {
    const rail = new MemoryStableRail();
    const a = await rail.openWallet("a");
    await rail.mint(a.address, "10");
    const send = (amount: string) =>
      rail.transfer({ fromWalletId: a.id, to: "x", amount, idempotencyKey: randomEventId() });
    expectOk(await send("7"));
    expectErr(await send("7"), "insufficient_funds");
  });
});

describe("MemoryDecide", () => {
  it("prefers options named in the state and accepts scripted answers", async () => {
    const options = [
      { id: "a", label: "Bulk Foods" },
      { id: "b", label: "Metro" },
    ];
    const heuristic = expectOk(
      await new MemoryDecide().decide({
        state: "We trust Metro.",
        questions: [{ kind: "choice", id: "q", prompt: "?", options }],
      }),
    );
    expect(heuristic.answers[0]).toMatchObject({ choice: "b" });
    const scripted = expectOk(
      await new MemoryDecide({
        answer: (q) =>
          q.kind === "noul"
            ? { kind: "noul", questionId: q.id, value: true, probability: 0.9, confidence: 0.9 }
            : undefined,
      }).decide({ state: "x", questions: [{ kind: "noul", id: "n", prompt: "?" }] }),
    );
    expect(scripted.answers[0]).toMatchObject({ value: true, probability: 0.9 });
  });
});

describe("routing helpers", () => {
  it("encodes polyline6 like the reference algorithm", () => {
    // Google's documented precision-5 example, scaled by 1/10 so the integers match at precision 6.
    const points = [
      { lat: 3.85, lng: -12.02 },
      { lat: 4.07, lng: -12.095 },
      { lat: 4.3252, lng: -12.6453 },
    ];
    const encoded = encodePolyline6(points);
    expect(encoded).toBe("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(decodePolyline6(encoded)).toEqual(points);
  });
});

describe("MemoryGeo", () => {
  it("sorts nulls last ascending", async () => {
    const geo = new MemoryGeo();
    expectOk(await geo.load("t", [{ v: null }, { v: 2 }, { v: 1 }]));
    const result = expectOk(
      await geo.query({ from: "t", orderBy: [{ column: "v", direction: "asc" }] }),
    );
    expect(result.rows.map((row) => row.v)).toEqual([1, 2, null]);
  });
});

describe("MemoryAgent directives", () => {
  it("reads nested JSON, including braces inside strings, and skips bad JSON", () => {
    const text =
      'First use the tool "a.b" with input {"x":{"y":"}"}}, then the tool "c" with input {oops} and the tool "d" with input {"n":1}.';
    expect(parseDirectives(text)).toEqual([
      { tool: "a.b", input: { x: { y: "}" } } },
      { tool: "d", input: { n: 1 } },
    ]);
  });
});
