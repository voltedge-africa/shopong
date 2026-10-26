// The OCN Capability MCP server (story 11.2): a refusal test for every refusal row, and the money gate.
// A real community on the in-memory record supplies the roles; agents hold tokens delegated from a member.
import { DAY_MS, signRequest, spaceUri } from "@shopong/community";
import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import { webCryptoSha512, type EventEnvelope } from "@shopong/events";
import type {
  CapabilityToken,
  Did,
  JsonValue,
  Money,
  ToolRegistry,
  ViewReader,
} from "@shopong/ports";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.ts";
import { createCapabilityServer, type CapabilityAudit, type ToolRun } from "./capability-mcp.ts";
import { defaultCapabilityTools } from "./capability-tools.ts";
import { createLogger } from "./logger.ts";
import { captureSink } from "./testing/capture.ts";
import { community, phone, randomHex, T0, type Phone } from "./testing/community.ts";

const rand = (n: number): Money => ({ currency: "ZAR", minor: n * 100 });

async function world(options: { ttl?: number; maxPending?: number } = {}) {
  const w = await community();
  // A role starts one day after it is granted, so the Node's clock is two days in.
  const clock = { now: T0 + 2 * DAY_MS };
  const resource = spaceUri(w.founder.key);
  const space = w.founder.key;
  await w.founder.grantRole(w.driver.did, "co-treasurer", { limit: rand(100), days: 90 }, T0);
  await w.network.replicate<EventEnvelope>(w.founder.space, w.driverCommunity.space);
  const grant = (await w.driverCommunity.roles())
    .find((r) => r.role === "co-treasurer")
    ?.grants.find((g) => g.ability === "payment/approve")?.token;
  if (grant === undefined) throw new Error("no grant");
  const revoked = new Set<string>();
  const view: ViewReader = {
    get: async (key) =>
      key.startsWith("revoked/") && revoked.has(key.slice("revoked/".length))
        ? true
        : w.founder.space.view.get(key),
    list: (prefix) => w.founder.space.view.list(prefix),
  };
  const calls: { tool: string; ctx: ToolRun }[] = [];
  const audit: CapabilityAudit[] = [];
  const handlers = {
    "ledger.read": async (_i: unknown, ctx: ToolRun): Promise<JsonValue> => {
      calls.push({ tool: "ledger.read", ctx });
      return { balance: 1 };
    },
    "order.propose": async (_i: unknown, ctx: ToolRun): Promise<JsonValue> => {
      calls.push({ tool: "order.propose", ctx });
      return { proposed: true };
    },
    "payment.request": async (_i: unknown, ctx: ToolRun): Promise<JsonValue> => {
      calls.push({ tool: "payment.request", ctx });
      return { paid: true };
    },
  };
  const serverAuth = new IsoUcanCapabilityAuth();
  const server = createCapabilityServer({
    auth: serverAuth,
    tools: defaultCapabilityTools(handlers),
    scopeOf: async (key) =>
      key === space
        ? { creator: w.creator.did, spaceKey: space, view, now: () => clock.now }
        : undefined,
    now: () => clock.now,
    audit: (entry) => audit.push(entry),
    ...(options.ttl === undefined ? {} : { confirmationTtlMs: options.ttl }),
    ...(options.maxPending === undefined ? {} : { maxPendingPerOwner: options.maxPending }),
  });

  /** A token for a new agent, delegated by `owner` from `proofs` (or issued by the creator when none). */
  async function agentToken(
    owner: Phone,
    can: string,
    extra: {
      ceiling?: Money;
      proofs?: CapabilityToken[];
      expiresAt?: number;
      notBefore?: number;
      with?: string;
      audience?: Did;
      auth?: IsoUcanCapabilityAuth;
    } = {},
  ) {
    const agent = await phone();
    const issued = await (extra.auth ?? owner.auth).issue({
      issuer: owner.did,
      audience: extra.audience ?? agent.did,
      capabilities: [
        {
          with: extra.with ?? resource,
          can,
          ...(extra.ceiling === undefined ? {} : { ceiling: extra.ceiling }),
        },
      ],
      notBefore: extra.notBefore ?? T0 + DAY_MS,
      expiresAt: extra.expiresAt ?? T0 + 3 * DAY_MS,
      ...(extra.proofs === undefined ? {} : { proofs: extra.proofs }),
    });
    if (!issued.ok) throw new Error(issued.error.message);
    return { agent, token: issued.value };
  }
  const read = (owner = w.creator) => agentToken(owner, "ledger/read");
  const moneyToken = (ceiling = rand(50)) =>
    agentToken(w.driver, "payment/approve", { ceiling, proofs: [grant] });
  const ctx = (capability: CapabilityToken) => ({ sessionId: "s1", capability });
  const pay = (minor = 4000) => ({
    space,
    payee: "m1",
    amount: { currency: "ZAR" as const, minor },
    reference: "pool top-up",
  });
  const lastDenied = async (
    name: string,
    input: JsonValue,
    capability: CapabilityToken,
  ): Promise<{ reason: string; problem: string | undefined }> => {
    const before = audit.length;
    const result = await server.call(name, input, ctx(capability));
    if (result.status !== "denied") throw new Error(`expected denied, got ${result.status}`);
    return { reason: result.reason, problem: audit.slice(before).at(-1)?.problem };
  };
  return {
    w,
    clock,
    space,
    resource,
    server,
    calls,
    audit,
    grant,
    revoked,
    serverAuth,
    agentToken,
    read,
    moneyToken,
    ctx,
    pay,
    lastDenied,
    handlers,
  };
}

describe("OCN Capability MCP server (AC 11.2): every call checks the session's authority", () => {
  it("lists every tool with a schema, an ability and a kind, and money only for payment", async () => {
    const k = await world();
    const tools = k.server.catalogue();
    expect(tools.map((t) => [t.name, t.ability, t.kind, t.money])).toEqual([
      ["ledger.read", "ledger/read", "read", false],
      ["order.propose", "order/propose", "write", false],
      ["payment.request", "payment/approve", "money", true],
    ]);
    for (const t of tools) expect(t.inputSchema).toMatchObject({ type: "object" });
    expect((await k.server.list()).length).toBe(3);
  });

  it("runs a read tool when the session holds the ability, passing the owner and agent", async () => {
    const k = await world();
    const { agent, token } = await k.read();
    const result = await k.server.call("ledger.read", { space: k.space }, k.ctx(token));
    expect(result).toEqual({ status: "ok", output: { balance: 1 } });
    expect(k.calls[0]?.ctx).toMatchObject({
      owner: k.w.creator.did,
      agent: agent.did,
      space: k.space,
    });
  });

  it("runs a write tool on its own ability", async () => {
    const k = await world();
    const { token } = await k.agentToken(k.w.creator, "order/propose");
    const result = await k.server.call(
      "order.propose",
      { space: k.space, name: "Bulk", items: [{ name: "Maize", quantity: 2 }] },
      k.ctx(token),
    );
    expect(result.status).toBe("ok");
  });

  describe("refusals, each with a reason and a code, and nothing runs", () => {
    it("unknown tool", async () => {
      const k = await world();
      const { token } = await k.read();
      expect(await k.lastDenied("secrets.read", { space: k.space }, token)).toEqual({
        reason: "That capability doesn't exist.",
        problem: "unknown_tool",
      });
    });

    it("input that does not fit the schema (missing space, extra field, wrong type)", async () => {
      const k = await world();
      const { token } = await k.read();
      for (const input of [{}, { space: k.space, extra: 1 }, { space: 5 }, "x", null]) {
        expect((await k.lastDenied("ledger.read", input as JsonValue, token)).problem).toBe(
          "invalid_input",
        );
      }
    });

    it("a community this Node does not hold", async () => {
      const k = await world();
      const { token } = await k.read();
      expect((await k.lastDenied("ledger.read", { space: "nope" }, token)).problem).toBe(
        "unknown_space",
      );
    });

    it("no token", async () => {
      const k = await world();
      const r = await k.lastDenied("ledger.read", { space: k.space }, "" as CapabilityToken);
      expect(r).toEqual({
        reason: "Send the proof of your role with the request.",
        problem: "missing_proof",
      });
    });

    it("a token that cannot be read", async () => {
      const k = await world();
      const r = await k.lastDenied(
        "ledger.read",
        { space: k.space },
        "not.a.token" as CapabilityToken,
      );
      expect(r.problem).toBe("tampered");
      expect(r.reason).toBe("This proof can't be checked.");
    });

    it("a tampered token", async () => {
      const k = await world();
      const { token } = await k.read();
      const at = Math.floor(token.length / 2);
      const bad =
        `${token.slice(0, at)}${token[at] === "A" ? "B" : "A"}${token.slice(at + 1)}` as CapabilityToken;
      expect((await k.lastDenied("ledger.read", { space: k.space }, bad)).problem).toBe("tampered");
    });

    it("a token from someone who is not the community's creator or a current grantee", async () => {
      const k = await world();
      const stranger = await phone();
      const { token } = await k.agentToken(stranger, "ledger/read");
      expect((await k.lastDenied("ledger.read", { space: k.space }, token)).problem).toBe(
        "tampered",
      );
    });

    it("an expired token", async () => {
      const k = await world();
      const { token } = await k.agentToken(k.w.creator, "ledger/read", {
        notBefore: T0,
        expiresAt: T0 + 3600_000,
      });
      const r = await k.lastDenied("ledger.read", { space: k.space }, token);
      expect(r.problem).toBe("ended");
      expect(r.reason).toContain("ended");
    });

    it("a token that has not started", async () => {
      const k = await world();
      const { token } = await k.agentToken(k.w.creator, "ledger/read", {
        notBefore: T0 + 4 * DAY_MS,
        expiresAt: T0 + 5 * DAY_MS,
      });
      expect((await k.lastDenied("ledger.read", { space: k.space }, token)).problem).toBe(
        "not_started",
      );
    });

    it("a token for another ability", async () => {
      const k = await world();
      const { token } = await k.read();
      const r = await k.lastDenied(
        "order.propose",
        { space: k.space, name: "x", items: [{ name: "y", quantity: 1 }] },
        token,
      );
      expect(r).toEqual({ reason: "Your role doesn't cover that.", problem: "outside" });
    });

    it("a token for another community's resource", async () => {
      const k = await world();
      const { token } = await k.agentToken(k.w.creator, "ledger/read", { with: "ocn:space/other" });
      expect((await k.lastDenied("ledger.read", { space: k.space }, token)).problem).toBe(
        "outside",
      );
    });

    it("a token the member took back", async () => {
      const k = await world();
      const { token } = await k.moneyToken();
      // The agent's chain goes through the member's grant; the creator takes that grant back.
      k.revoked.add(await k.serverAuth.tokenId(k.grant));
      const r = await k.lastDenied("payment.request", k.pay(), token);
      expect(r.problem).toBe("revoked");
    });

    it("a grant the creator has since replaced (not current)", async () => {
      const k = await world();
      const { token } = await k.moneyToken();
      await k.w.founder.grantRole(
        k.w.driver.did,
        "co-treasurer",
        { limit: rand(10), days: 90 },
        T0 + 1000,
      );
      expect((await k.lastDenied("payment.request", k.pay(), token)).problem).toBe("not_current");
    });

    it("an identity that made its own authority", async () => {
      const k = await world();
      const { token } = await k.agentToken(k.w.creator, "ledger/read", {
        audience: k.w.creator.did,
      });
      const r = await k.lastDenied("ledger.read", { space: k.space }, token);
      expect(r.problem).toBe("not_delegated");
    });

    it("a money amount above the ceiling", async () => {
      const k = await world();
      const { token } = await k.moneyToken(rand(50));
      const r = await k.lastDenied("payment.request", k.pay(60_00), token);
      expect(r.problem).toBe("over_limit");
      expect(r.reason).toContain("R50");
      expect(k.calls).toHaveLength(0);
    });

    it("a session that tries to hold more than its member (amplification) cannot even be issued", async () => {
      // Verify-time refusal of an amplifying chain is the CapabilityAuth contract (adapter-ucan-iso tests); the
      // server relies on it. Here the member's own key refuses to sign a larger ceiling than the grant.
      const k = await world();
      const issued = await k.w.driver.auth.issue({
        issuer: k.w.driver.did,
        audience: (await phone()).did,
        capabilities: [{ with: k.resource, can: "payment/approve", ceiling: rand(5000) }],
        notBefore: T0 + DAY_MS,
        expiresAt: T0 + 3 * DAY_MS,
        proofs: [k.grant],
      });
      expect(issued.ok ? undefined : issued.error.code).toBe("not_attenuated");
    });

    it("a tool with no handler wired answers an error, and changes nothing", async () => {
      const k = await world();
      const bare = createCapabilityServer({
        auth: k.serverAuth,
        tools: defaultCapabilityTools(),
        scopeOf: async () => ({
          creator: k.w.creator.did,
          spaceKey: k.space,
          view: k.w.founder.space.view,
          now: () => k.clock.now,
        }),
        now: () => k.clock.now,
      });
      const { token } = await k.read();
      const result = await bare.call("ledger.read", { space: k.space }, k.ctx(token));
      expect(result.status).toBe("error");
    });
  });

  it("writes no token, signature or input value to the audit trail", async () => {
    const k = await world();
    const { token } = await k.moneyToken();
    await k.server.call("payment.request", { ...k.pay(), reference: "SECRET-REF" }, k.ctx(token));
    const text = JSON.stringify(k.audit);
    expect(text).not.toContain(token);
    expect(text).not.toContain("SECRET-REF");
    expect(k.audit.at(-1)).toMatchObject({
      event: "confirmation_created",
      outcome: "needs_confirmation",
    });
  });
});

describe("money tools: nothing runs until the member approves (hitl gate)", () => {
  it("a money call returns needs_confirmation, written by the server, and runs nothing", async () => {
    const k = await world();
    const { token } = await k.moneyToken();
    const result = await k.server.call("payment.request", k.pay(), k.ctx(token));
    expect(result.status).toBe("needs_confirmation");
    if (result.status !== "needs_confirmation") return;
    expect(result.confirmation.tool).toBe("payment.request");
    expect(result.confirmation.summary).toBe("Pay R40 to m1 for pool top-up");
    expect(k.calls).toHaveLength(0);
    expect(k.server.pending(k.w.driver.did)).toHaveLength(1);
  });

  it("no money-classified tool ever returns ok on an agent's call, however often it is repeated", async () => {
    const k = await world();
    const { token } = await k.moneyToken();
    for (const tool of k.server.catalogue().filter((t) => t.kind === "money")) {
      for (let i = 0; i < 3; i++) {
        const result = await k.server.call(tool.name, k.pay(), k.ctx(token));
        expect(result.status).toBe("needs_confirmation");
      }
    }
    expect(k.calls).toHaveLength(0);
  });

  it("the member's approval runs it once, with the confirmation id as the idempotency key", async () => {
    const k = await world();
    const { token } = await k.moneyToken();
    const asked = await k.server.call("payment.request", k.pay(), k.ctx(token));
    if (asked.status !== "needs_confirmation") throw new Error("expected confirmation");
    const id = asked.confirmation.id;
    const done = await k.server.confirm(id, k.w.driver.did, "approve");
    expect(done).toEqual({ ok: true, decision: "approved", output: { paid: true } });
    expect(k.calls).toHaveLength(1);
    expect(k.calls[0]?.ctx).toMatchObject({ idempotencyKey: id, owner: k.w.driver.did });
    // A second answer, even at once, cannot run it again.
    const again = await Promise.all([
      k.server.confirm(id, k.w.driver.did, "approve"),
      k.server.confirm(id, k.w.driver.did, "approve"),
    ]);
    expect(again.every((r) => !r.ok && r.problem === "already_decided")).toBe(true);
    expect(k.calls).toHaveLength(1);
  });

  it("two simultaneous approvals run it once", async () => {
    const k = await world();
    const { token } = await k.moneyToken();
    const asked = await k.server.call("payment.request", k.pay(), k.ctx(token));
    if (asked.status !== "needs_confirmation") throw new Error("expected confirmation");
    const results = await Promise.all([
      k.server.confirm(asked.confirmation.id, k.w.driver.did, "approve"),
      k.server.confirm(asked.confirmation.id, k.w.driver.did, "approve"),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(k.calls).toHaveLength(1);
  });

  it("the agent cannot approve its own request", async () => {
    const k = await world();
    const { agent, token } = await k.moneyToken();
    const asked = await k.server.call("payment.request", k.pay(), k.ctx(token));
    if (asked.status !== "needs_confirmation") throw new Error("expected confirmation");
    const r = await k.server.confirm(asked.confirmation.id, agent.did, "approve");
    expect(r).toMatchObject({ ok: false, problem: "not_the_owner" });
    expect(k.calls).toHaveLength(0);
  });

  it("another member, or the creator, cannot approve it either", async () => {
    const k = await world();
    const { token } = await k.moneyToken();
    const asked = await k.server.call("payment.request", k.pay(), k.ctx(token));
    if (asked.status !== "needs_confirmation") throw new Error("expected confirmation");
    for (const who of [k.w.other.did, k.w.creator.did]) {
      expect(await k.server.confirm(asked.confirmation.id, who, "approve")).toMatchObject({
        ok: false,
        problem: "not_the_owner",
      });
    }
    expect(k.calls).toHaveLength(0);
  });

  it("an unknown confirmation number is refused", async () => {
    const k = await world();
    expect(await k.server.confirm("nope", k.w.driver.did, "approve")).toMatchObject({
      ok: false,
      problem: "unknown_confirmation",
    });
  });

  it("a declined request never runs, and cannot be approved afterwards", async () => {
    const k = await world();
    const { token } = await k.moneyToken();
    const asked = await k.server.call("payment.request", k.pay(), k.ctx(token));
    if (asked.status !== "needs_confirmation") throw new Error("expected confirmation");
    expect(await k.server.confirm(asked.confirmation.id, k.w.driver.did, "decline")).toEqual({
      ok: true,
      decision: "declined",
    });
    expect(await k.server.confirm(asked.confirmation.id, k.w.driver.did, "approve")).toMatchObject({
      ok: false,
      problem: "already_decided",
    });
    expect(k.calls).toHaveLength(0);
    expect(k.server.pending(k.w.driver.did)).toHaveLength(0);
  });

  it("a request that waited too long expires and never runs", async () => {
    const k = await world({ ttl: 60_000 });
    const { token } = await k.moneyToken();
    const asked = await k.server.call("payment.request", k.pay(), k.ctx(token));
    if (asked.status !== "needs_confirmation") throw new Error("expected confirmation");
    k.clock.now += 60_000;
    expect(await k.server.confirm(asked.confirmation.id, k.w.driver.did, "approve")).toMatchObject({
      ok: false,
      problem: "confirmation_expired",
    });
    expect(k.calls).toHaveLength(0);
  });

  it("the authority is checked again at approval: a grant taken back while waiting stops the payment", async () => {
    const k = await world();
    const { token } = await k.moneyToken();
    const asked = await k.server.call("payment.request", k.pay(), k.ctx(token));
    if (asked.status !== "needs_confirmation") throw new Error("expected confirmation");
    k.revoked.add(await k.serverAuth.tokenId(k.grant));
    const r = await k.server.confirm(asked.confirmation.id, k.w.driver.did, "approve");
    expect(r).toMatchObject({ ok: false, problem: "revoked" });
    expect(k.calls).toHaveLength(0);
  });

  it("the token's end while waiting also stops it", async () => {
    const k = await world();
    const { token } = await k.moneyToken();
    const asked = await k.server.call("payment.request", k.pay(), k.ctx(token));
    if (asked.status !== "needs_confirmation") throw new Error("expected confirmation");
    k.clock.now = T0 + 3 * DAY_MS + 1;
    // Within the 15 minute wait? No: the wait is over too, so either refusal keeps it from running.
    const r = await k.server.confirm(asked.confirmation.id, k.w.driver.did, "approve");
    expect(r.ok).toBe(false);
    expect(k.calls).toHaveLength(0);
  });

  it("limits how many requests wait for one member", async () => {
    const k = await world({ maxPending: 2 });
    const { token } = await k.moneyToken();
    await k.server.call("payment.request", k.pay(), k.ctx(token));
    await k.server.call("payment.request", k.pay(), k.ctx(token));
    expect((await k.lastDenied("payment.request", k.pay(), token)).problem).toBe(
      "too_many_pending",
    );
  });

  it("a handler that fails after approval reports it, changes nothing more, and cannot be retried", async () => {
    const k = await world();
    const failing = createCapabilityServer({
      auth: k.serverAuth,
      tools: defaultCapabilityTools(),
      scopeOf: async () => ({
        creator: k.w.creator.did,
        spaceKey: k.space,
        view: k.w.founder.space.view,
        now: () => k.clock.now,
      }),
      now: () => k.clock.now,
    });
    const { token } = await k.moneyToken();
    const asked = await failing.call("payment.request", k.pay(), k.ctx(token));
    if (asked.status !== "needs_confirmation") throw new Error("expected confirmation");
    expect(await failing.confirm(asked.confirmation.id, k.w.driver.did, "approve")).toMatchObject({
      ok: false,
      problem: "run_failed",
    });
    expect(await failing.confirm(asked.confirmation.id, k.w.driver.did, "approve")).toMatchObject({
      ok: false,
      problem: "already_decided",
    });
  });

  it("the agent has no tool that confirms: the registry offers none", async () => {
    const k = await world();
    const names = (await k.server.list()).map((t) => t.name);
    expect(names.some((n) => /confirm|approve/i.test(n))).toBe(false);
    const { token } = await k.moneyToken();
    for (const name of ["capability.confirm", "confirm", "payment.confirm"]) {
      expect((await k.lastDenied(name, { id: "x" }, token)).problem).toBe("unknown_tool");
    }
  });
});

describe("HTTP: POST /mcp and POST /capability/confirm", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function boot() {
    const k = await world();
    const sink = captureSink();
    app = buildApp({
      logger: createLogger({ level: "info", sink }),
      version: "test",
      components: [],
      capabilityMcp: k.server,
      authority: {
        creator: k.w.creator.did,
        spaceKey: k.space,
        view: k.w.founder.space.view,
        now: () => k.clock.now,
      },
    });
    const rpc = (method: string, params: unknown, token?: string, session: string | null = "s1") =>
      app!.inject({
        method: "POST",
        url: "/mcp",
        headers: {
          "content-type": "application/json",
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
          ...(session === null ? {} : { "mcp-session-id": session }),
        },
        payload: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
    const confirm = async (signer: Phone, body: object, options: { time?: number } = {}) => {
      const text = JSON.stringify(body);
      const headers = await signRequest(
        signer.auth,
        {
          method: "POST",
          path: "/capability/confirm",
          body: text,
          nonce: randomHex(16),
          time: options.time ?? k.clock.now,
          actor: signer.did,
        },
        webCryptoSha512,
      );
      if (!headers.ok) throw new Error(headers.error.message);
      return app!.inject({
        method: "POST",
        url: "/capability/confirm",
        headers: { ...headers.value, "content-type": "application/json" },
        payload: text,
      });
    };
    return { ...k, rpc, confirm, sink };
  }

  it("answers initialize, ping, tools/list (with ability and kind) and a notification", async () => {
    const h = await boot();
    expect((await h.rpc("initialize", {})).json().result.serverInfo.name).toBe("ocn-capability");
    expect((await h.rpc("ping", {})).json().result).toEqual({});
    const listed = (await h.rpc("tools/list", {})).json().result.tools;
    expect(listed.map((t: { name: string }) => t.name)).toEqual([
      "ledger.read",
      "order.propose",
      "payment.request",
    ]);
    expect(listed[2]._meta).toEqual({ ability: "payment/approve", kind: "money" });
    expect(listed[0].annotations.readOnlyHint).toBe(true);
    const note = await app!.inject({
      method: "POST",
      url: "/mcp",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    expect(note.statusCode).toBe(202);
  });

  it("refuses bad JSON-RPC, an unknown method and a missing session", async () => {
    const h = await boot();
    const bad = await app!.inject({
      method: "POST",
      url: "/mcp",
      headers: { "content-type": "application/json" },
      payload: "{nope",
    });
    expect(bad.json().error.code).toBe(-32700);
    expect((await h.rpc("nothing/here", {})).json().error.code).toBe(-32601);
    const { token } = await h.read();
    const noSession = await h.rpc(
      "tools/call",
      { name: "ledger.read", arguments: { space: h.space } },
      token,
      null,
    );
    expect(noSession.json().error.code).toBe(-32602);
  });

  it("a call without the right authority comes back as an error with the reason", async () => {
    const h = await boot();
    const none = await h.rpc("tools/call", { name: "ledger.read", arguments: { space: h.space } });
    expect(none.json().result).toEqual({
      content: [{ type: "text", text: "Send the proof of your role with the request." }],
      isError: true,
    });
    const { token } = await h.read();
    const wrong = await h.rpc(
      "tools/call",
      {
        name: "order.propose",
        arguments: { space: h.space, name: "a", items: [{ name: "b", quantity: 1 }] },
      },
      token,
    );
    expect(wrong.json().result).toMatchObject({
      isError: true,
      content: [{ text: "Your role doesn't cover that." }],
    });
    expect(h.calls).toHaveLength(0);
  });

  it("a read call runs", async () => {
    const h = await boot();
    const { token } = await h.read();
    const res = await h.rpc(
      "tools/call",
      { name: "ledger.read", arguments: { space: h.space } },
      token,
    );
    expect(res.json().result).toEqual({
      content: [{ type: "text", text: '{"balance":1}' }],
      isError: false,
    });
  });

  it("a money call waits; only the member's signed answer runs it", async () => {
    const h = await boot();
    const { agent, token } = await h.moneyToken();
    const res = await h.rpc("tools/call", { name: "payment.request", arguments: h.pay() }, token);
    const result = res.json().result;
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({
      status: "needs_confirmation",
      summary: "Pay R40 to m1 for pool top-up",
    });
    expect(h.calls).toHaveLength(0);
    const id = result.structuredContent.confirmationId as string;

    // The agent, signing with its own key, is refused.
    const byAgent = await h.confirm(agent, { id, decision: "approve" });
    expect(byAgent.statusCode).toBe(403);
    expect(byAgent.json()).toMatchObject({ done: false, problem: "not_the_owner" });
    // An unsigned request is refused.
    const unsigned = await app!.inject({
      method: "POST",
      url: "/capability/confirm",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ id, decision: "approve" }),
    });
    expect(unsigned.statusCode).toBe(401);
    // A malformed body is refused.
    expect((await h.confirm(h.w.driver, { id })).statusCode).toBe(400);
    expect(h.calls).toHaveLength(0);

    // The member approves.
    const approved = await h.confirm(h.w.driver, { id, decision: "approve" });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toEqual({ done: true, decision: "approved" });
    expect(h.calls).toHaveLength(1);
    expect((await h.confirm(h.w.driver, { id, decision: "approve" })).json().problem).toBe(
      "already_decided",
    );
    expect(h.calls).toHaveLength(1);
  });

  it("the MCP route offers no way to confirm", async () => {
    const h = await boot();
    const { token } = await h.moneyToken();
    const res = await h.rpc(
      "tools/call",
      { name: "capability.confirm", arguments: { id: "x", decision: "approve" } },
      token,
    );
    expect(res.json().result.isError).toBe(true);
    expect(res.json().result.content[0].text).toBe("That capability doesn't exist.");
  });

  it("is not served unless the Node is given a server", async () => {
    const plain = buildApp({
      logger: createLogger({ level: "silent", sink: captureSink() }),
      version: "t",
      components: [],
    });
    app = plain;
    expect((await plain.inject({ method: "POST", url: "/mcp", payload: "{}" })).statusCode).toBe(
      404,
    );
  });
});

// The server satisfies the port the agent stories depend on.
describe("ToolRegistry port", () => {
  it("is a ToolRegistry whose list matches the catalogue", async () => {
    const k = await world();
    const registry: ToolRegistry = k.server;
    expect((await registry.list()).map((t) => t.name)).toEqual(
      k.server.catalogue().map((t) => t.name),
    );
  });
});
