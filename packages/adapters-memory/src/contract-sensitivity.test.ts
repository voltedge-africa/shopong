// The contracts must fail for adapters that break the port's rules. Each test runs one
// contract case against a deliberately broken adapter and expects it to fail.
import { describe, expect, it } from "vite-plus/test";
import {
  agentContract,
  capabilityAuthContract,
  genUiContract,
  ledgerContract,
  payInContract,
  type ContractCase,
} from "@shopong/ports-contract";
import {
  ok,
  type Agent,
  type CapabilityAuth,
  type GenUi,
  type Ledger,
  type PayIn,
} from "@shopong/ports";
import {
  MemoryAgent,
  MemoryCapabilityAuth,
  MemoryGenUi,
  MemoryLedger,
  MemoryPayIn,
} from "./index.js";

async function expectCaseFails<H>(
  cases: readonly ContractCase<H>[],
  name: string,
  harness: H,
): Promise<void> {
  const contractCase = cases.find((c) => c.name === name);
  if (contractCase === undefined) throw new Error(`no contract case named "${name}"`);
  await expect(contractCase.run(harness)).rejects.toThrow();
}

describe("contract sensitivity", () => {
  it("Ledger: an adapter that forgets idempotency keys fails the replay case", async () => {
    const inner = new MemoryLedger();
    let n = 0;
    const forgetful: Ledger = {
      configureAccount: (a, o) => inner.configureAccount(a, o),
      post: (request) =>
        inner.post({ ...request, idempotencyKey: `${request.idempotencyKey}#${String(n++)}` }),
      findByIdempotencyKey: (key) => inner.findByIdempotencyKey(key),
      balance: (a, c) => inner.balance(a, c),
      trialBalance: () => inner.trialBalance(),
    };
    await expectCaseFails(
      ledgerContract,
      "the same key and body is a replay, not a second transaction",
      forgetful,
    );
  });

  it("CapabilityAuth: a verify that reads the wall clock fails the log-time case", async () => {
    const inner = new MemoryCapabilityAuth();
    const wallClock: CapabilityAuth = {
      createIdentity: () => inner.createIdentity(),
      issue: (r) => inner.issue(r),
      decode: (t) => inner.decode(t),
      tokenId: (t) => inner.tokenId(t),
      verify: (t, r) => inner.verify(t, { ...r, logTime: Date.now() }),
      sign: (d, b) => inner.sign(d, b),
      verifySignature: (d, b, s) => inner.verifySignature(d, b, s),
    };
    await expectCaseFails(
      capabilityAuthContract,
      "validity uses the supplied log time, never the wall clock",
      wallClock,
    );
  });

  it("CapabilityAuth: a verifySignature that accepts anything fails the signature case", async () => {
    const inner = new MemoryCapabilityAuth();
    const trusting: CapabilityAuth = {
      createIdentity: () => inner.createIdentity(),
      issue: (r) => inner.issue(r),
      decode: (t) => inner.decode(t),
      tokenId: (t) => inner.tokenId(t),
      verify: (t, r) => inner.verify(t, r),
      sign: (d, b) => inner.sign(d, b),
      verifySignature: async () => true,
    };
    await expectCaseFails(
      capabilityAuthContract,
      "a signature verifies for its identity and those exact bytes only",
      trusting,
    );
  });

  it("PayIn: an adapter that skips signature checks fails the webhook case", async () => {
    const payIn = new MemoryPayIn({ clock: { now: () => Date.now() } });
    const trusting: PayIn = {
      createRequest: (input) => payIn.createRequest(input),
      getRequest: (id) => payIn.getRequest(id),
      cancelRequest: (id) => payIn.cancelRequest(id),
      // Believes any body: re-signs it instead of checking the signature.
      ingestWebhook: async (delivery) => {
        const { paymentId } = JSON.parse(delivery.body) as { paymentId: string };
        return payIn.ingestWebhook(payIn.simulateWebhook(paymentId, "completed"));
      },
    };
    await expectCaseFails(
      payInContract,
      "a webhook with a bad or missing signature is refused and changes nothing",
      { payIn: trusting, settle: async (id, outcome) => payIn.simulateWebhook(id, outcome) },
    );
  });

  it("Agent: an agent that swaps in another capability fails the registry case", async () => {
    const inner = new MemoryAgent();
    const escalating: Agent = {
      startSession: (request) =>
        inner.startSession({ ...request, capability: "owner-token" as typeof request.capability }),
    };
    const auth = new MemoryCapabilityAuth();
    const owner = await auth.createIdentity();
    const capability = await auth.issue({
      issuer: owner,
      audience: owner,
      capabilities: [{ with: "ocn:space/x", can: "agent/act" }],
      expiresAt: Date.now() + 60_000,
    });
    if (!capability.ok) throw new Error(capability.error.message);
    await expectCaseFails(
      agentContract,
      "calls tools only through the registry, always with the session capability",
      { agent: escalating, owner, capability: capability.value },
    );
  });

  it("GenUi: a validator that accepts anything fails the allow-list cases", async () => {
    const inner = new MemoryGenUi();
    const permissive: GenUi = {
      systemPrompt: (library) => inner.systemPrompt(library),
      print: (document) => inner.print(document),
      validate: async (library, source) => ok({ library, root: JSON.parse(source) as never }),
    };
    await expectCaseFails(genUiContract, "refuses components outside the library", permissive);
    await expectCaseFails(genUiContract, "refuses actions a component may not trigger", permissive);
  });
});
