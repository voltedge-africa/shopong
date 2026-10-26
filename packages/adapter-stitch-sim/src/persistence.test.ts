import { describe, expect, it } from "vite-plus/test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { money, type Did } from "@shopong/ports";
import { randomEventId } from "@shopong/ports-contract";
import { createSimulatedStitch } from "./index.js";
import { lineSink, manualClock, randomKey, scratchFolder, webCryptoHmac } from "./testing.js";

const folder = scratchFolder();
// The file is written where the Node keeps its data; the tests reuse one folder for each case.
let n = 0;
const fresh = (): string => folder.file(`state-${String(++n)}.json`);

const approver = "did:key:z6MkTreasurer" as Did;

describe("simulated payments survive a restart (persisted in the data folder)", () => {
  it("keeps a completed request completed, and a replay after restart is applied: false", async () => {
    const key = randomKey();
    const stateFile = fresh();
    const first = createSimulatedStitch({ webhookKey: key, hmac: webCryptoHmac, stateFile });
    const created = await first.payIn.createRequest({
      amount: money("ZAR", 15000),
      externalReference: randomEventId(),
      payerReference: "STOKVEL",
      beneficiaryReference: "OCN POOL",
      expireAt: Date.now() + 86_400_000,
    });
    if (!created.ok) throw new Error(created.error.message);
    const delivery = await first.payIn.settle(created.value.id, "completed");
    expect((await first.payIn.ingestWebhook(delivery)).ok).toBe(true);

    const second = createSimulatedStitch({ webhookKey: key, hmac: webCryptoHmac, stateFile });
    expect((await second.payIn.getRequest(created.value.id))?.status).toBe("completed");
    const replay = await second.payIn.ingestWebhook(delivery);
    expect(replay.ok && replay.value.applied).toBe(false);
  });

  it("keeps a pending request pending, still idempotent, and still completable", async () => {
    const key = randomKey();
    const stateFile = fresh();
    const reference = randomEventId();
    const input = {
      amount: money("ZAR", 9900),
      externalReference: reference,
      payerReference: "STOKVEL",
      beneficiaryReference: "OCN POOL",
      expireAt: Date.now() + 86_400_000,
    };
    const first = createSimulatedStitch({ webhookKey: key, hmac: webCryptoHmac, stateFile });
    const created = await first.payIn.createRequest(input);
    if (!created.ok) throw new Error(created.error.message);

    const second = createSimulatedStitch({ webhookKey: key, hmac: webCryptoHmac, stateFile });
    const again = await second.payIn.createRequest({ ...input });
    expect(again.ok && again.value.id).toBe(created.value.id);
    const conflict = await second.payIn.createRequest({ ...input, amount: money("ZAR", 1) });
    expect(!conflict.ok && conflict.error.code).toBe("idempotency_conflict");

    const delivery = await second.payIn.settle(created.value.id, "completed");
    const applied = await second.payIn.ingestWebhook(delivery);
    expect(applied.ok && applied.value.applied).toBe(true);
  });

  it("never reuses an id after a restart", async () => {
    const key = randomKey();
    const stateFile = fresh();
    const make = async (sim: ReturnType<typeof createSimulatedStitch>) => {
      const r = await sim.payIn.createRequest({
        amount: money("ZAR", 100),
        externalReference: randomEventId(),
        payerReference: "A",
        beneficiaryReference: "B",
        expireAt: Date.now() + 86_400_000,
      });
      if (!r.ok) throw new Error(r.error.message);
      return r.value.id;
    };
    const ids = new Set<string>();
    ids.add(await make(createSimulatedStitch({ webhookKey: key, hmac: webCryptoHmac, stateFile })));
    ids.add(await make(createSimulatedStitch({ webhookKey: key, hmac: webCryptoHmac, stateFile })));
    ids.add(await make(createSimulatedStitch({ webhookKey: key, hmac: webCryptoHmac, stateFile })));
    expect(ids.size).toBe(3);
  });

  it("keeps a payout's status across a restart", async () => {
    const key = randomKey();
    const stateFile = fresh();
    const first = createSimulatedStitch({ webhookKey: key, hmac: webCryptoHmac, stateFile });
    const created = await first.payOut.createPayout({
      amount: money("ZAR", 450000),
      externalReference: randomEventId(),
      beneficiary: {
        name: "Bulk Foods",
        bankId: "fnb",
        accountNumber: "62000000001",
        accountType: "current",
      },
      beneficiaryReference: "ORDER 42",
      approval: { eventId: randomEventId(), approvers: [approver] },
    });
    if (!created.ok) throw new Error(created.error.message);
    const second = createSimulatedStitch({ webhookKey: key, hmac: webCryptoHmac, stateFile });
    expect((await second.payOut.getPayout(created.value.id))?.status).toBe("pending");
    const applied = await second.payOut.ingestWebhook(
      await second.payOut.settle(created.value.id, "completed"),
    );
    expect(applied.ok && applied.value.applied).toBe(true);
    const third = createSimulatedStitch({ webhookKey: key, hmac: webCryptoHmac, stateFile });
    expect((await third.payOut.getPayout(created.value.id))?.status).toBe("completed");
  });

  it("writes the state with a temporary file renamed into place, leaving no temporary file", async () => {
    const stateFile = fresh();
    const sim = createSimulatedStitch({ webhookKey: randomKey(), hmac: webCryptoHmac, stateFile });
    await sim.payIn.createRequest({
      amount: money("ZAR", 100),
      externalReference: randomEventId(),
      payerReference: "A",
      beneficiaryReference: "B",
      expireAt: Date.now() + 86_400_000,
    });
    expect(existsSync(stateFile)).toBe(true);
    expect(existsSync(`${stateFile}.tmp`)).toBe(false);
    expect(() => JSON.parse(readFileSync(stateFile, "utf8"))).not.toThrow();
  });

  it("never writes the webhook key or a beneficiary's account number to disk", async () => {
    const key = randomKey();
    const stateFile = fresh();
    const sim = createSimulatedStitch({ webhookKey: key, hmac: webCryptoHmac, stateFile });
    await sim.payOut.createPayout({
      amount: money("ZAR", 1000),
      externalReference: randomEventId(),
      beneficiary: {
        name: "Bulk Foods",
        bankId: "fnb",
        accountNumber: "62000000001",
        accountType: "current",
      },
      beneficiaryReference: "ORDER 42",
      approval: { eventId: randomEventId(), approvers: [approver] },
    });
    const text = readFileSync(stateFile, "utf8");
    expect(text).not.toContain("62000000001");
    expect(text).not.toContain(Array.from(key, (b) => b.toString(16).padStart(2, "0")).join(""));
  });

  it("keeps a late completion flagged across a restart", async () => {
    const key = randomKey();
    const stateFile = fresh();
    const clock = manualClock();
    const first = createSimulatedStitch({ webhookKey: key, hmac: webCryptoHmac, stateFile, clock });
    const created = await first.payIn.createRequest({
      amount: money("ZAR", 100),
      externalReference: randomEventId(),
      payerReference: "A",
      beneficiaryReference: "B",
      expireAt: clock.now() + 1000,
    });
    if (!created.ok) throw new Error(created.error.message);
    clock.advance(5000);
    await first.payIn.ingestWebhook(await first.payIn.settle(created.value.id, "completed"));
    const second = createSimulatedStitch({
      webhookKey: key,
      hmac: webCryptoHmac,
      stateFile,
      clock,
    });
    expect(second.lateCompletions().map((l) => l.paymentId)).toEqual([created.value.id]);
    expect((await second.payIn.getRequest(created.value.id))?.status).toBe("expired");
  });

  it("refuses a state file it cannot read, naming the path and not the content", () => {
    const stateFile = fresh();
    writeFileSync(stateFile, "SECRET-CONTENT-DO-NOT-ECHO {");
    let message = "";
    try {
      createSimulatedStitch({ webhookKey: randomKey(), hmac: webCryptoHmac, stateFile });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(stateFile);
    expect(message).toContain("simulated");
    expect(message).not.toContain("SECRET-CONTENT");
  });

  it("refuses a state file of another format version", () => {
    const stateFile = fresh();
    writeFileSync(
      stateFile,
      JSON.stringify({
        format: "simulated-stitch/999",
        counter: 0,
        records: [],
        lateCompletions: [],
      }),
    );
    expect(() =>
      createSimulatedStitch({ webhookKey: randomKey(), hmac: webCryptoHmac, stateFile }),
    ).toThrow(/simulated-stitch/);
  });

  it("logs nothing about a plain create (the log is for refusals, late completions and state trouble)", async () => {
    const log = lineSink();
    const sim = createSimulatedStitch({
      webhookKey: randomKey(),
      hmac: webCryptoHmac,
      log: log.log,
      stateFile: fresh(),
    });
    await sim.payIn.createRequest({
      amount: money("ZAR", 100),
      externalReference: randomEventId(),
      payerReference: "A",
      beneficiaryReference: "B",
      expireAt: Date.now() + 86_400_000,
    });
    expect(log.lines).toEqual([]);
  });
});

// Review item 5: a failed state write must not leave memory ahead of disk. The failure is injected for real: a
// directory where the temporary file must be written makes the open fail with EISDIR, after the change was made.
describe("a failed state write leaves nothing applied (review item 5)", () => {
  const input = (reference: string) => ({
    amount: money("ZAR", 4200),
    externalReference: reference as ReturnType<typeof randomEventId>,
    payerReference: "STOKVEL",
    beneficiaryReference: "OCN POOL",
    expireAt: Date.now() + 86_400_000,
  });

  it("a request whose write fails is not kept: the same create keeps failing, not answering from memory", async () => {
    const key = randomKey();
    const stateFile = fresh();
    const sim = createSimulatedStitch({ webhookKey: key, hmac: webCryptoHmac, stateFile });
    const reference = randomEventId();
    mkdirSync(`${stateFile}.tmp`);
    await expect(sim.payIn.createRequest(input(reference))).rejects.toThrow();
    await expect(sim.payIn.createRequest(input(reference))).rejects.toThrow();
    rmSync(`${stateFile}.tmp`, { recursive: true });
    const after = await sim.payIn.createRequest(input(reference));
    expect(after.ok).toBe(true);
    const reopened = createSimulatedStitch({ webhookKey: key, hmac: webCryptoHmac, stateFile });
    if (!after.ok) throw new Error("setup");
    expect((await reopened.payIn.getRequest(after.value.id))?.status).toBe("pending");
  });

  it("a completion whose write fails is not applied in memory, so a restart and a retry agree", async () => {
    const key = randomKey();
    const stateFile = fresh();
    const sim = createSimulatedStitch({ webhookKey: key, hmac: webCryptoHmac, stateFile });
    const created = await sim.payIn.createRequest(input(randomEventId()));
    if (!created.ok) throw new Error(created.error.message);
    const delivery = await sim.payIn.settle(created.value.id, "completed");

    mkdirSync(`${stateFile}.tmp`);
    await expect(sim.payIn.ingestWebhook(delivery)).rejects.toThrow();
    expect((await sim.payIn.getRequest(created.value.id))?.status).toBe("pending");
    rmSync(`${stateFile}.tmp`, { recursive: true });

    const reopened = createSimulatedStitch({ webhookKey: key, hmac: webCryptoHmac, stateFile });
    expect((await reopened.payIn.getRequest(created.value.id))?.status).toBe("pending");
    const retried = await sim.payIn.ingestWebhook(delivery);
    expect(retried.ok && retried.value.applied).toBe(true);
    const finalState = createSimulatedStitch({ webhookKey: key, hmac: webCryptoHmac, stateFile });
    expect((await finalState.payIn.getRequest(created.value.id))?.status).toBe("completed");
  });

  it("a flagged late completion whose write fails is not flagged in memory", async () => {
    const key = randomKey();
    const stateFile = fresh();
    const clock = manualClock();
    const sim = createSimulatedStitch({ webhookKey: key, hmac: webCryptoHmac, stateFile, clock });
    const created = await sim.payIn.createRequest({
      ...input(randomEventId()),
      expireAt: clock.now() + 1000,
    });
    if (!created.ok) throw new Error(created.error.message);
    const delivery = await sim.payIn.settle(created.value.id, "completed");
    clock.advance(5000);
    mkdirSync(`${stateFile}.tmp`);
    await expect(sim.payIn.ingestWebhook(delivery)).rejects.toThrow();
    expect(sim.lateCompletions()).toEqual([]);
    rmSync(`${stateFile}.tmp`, { recursive: true });
  });
});

describe("payment ids are unguessable (review item 1)", () => {
  it("are random 128-bit tokens, never sequential", async () => {
    const sim = createSimulatedStitch({ webhookKey: randomKey(), hmac: webCryptoHmac });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const created = await sim.payIn.createRequest({
        amount: money("ZAR", 100),
        externalReference: randomEventId(),
        payerReference: "A",
        beneficiaryReference: "B",
        expireAt: Date.now() + 86_400_000,
      });
      if (!created.ok) throw new Error(created.error.message);
      ids.push(created.value.id);
    }
    for (const id of ids) expect(id).toMatch(/^pir_[0-9a-f]{32}$/u);
    expect(await sim.payIn.getRequest("pir_1")).toBeUndefined();
    expect(await sim.payIn.getRequest("pir_2")).toBeUndefined();
    expect(new Set(ids).size).toBe(3);
  });
});
