import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  NoFixtureMatchError,
  RECORDED_DIR,
  assertMeta,
  createReplayFetch,
  listFixtures,
  loadAll,
  loadFixture,
  validateMeta,
} from "./index.js";

const FIRST_SCENARIOS = {
  stitch: ["create-payment-request", "payment-completed-webhook"],
  ledfra: ["post-transaction", "idempotent-replay", "unbalanced-400", "guarded-422"],
};

describe("shipped fixtures", () => {
  it("include the first payment and ledger calls", () => {
    const found = listFixtures();
    for (const [service, scenarios] of Object.entries(FIRST_SCENARIOS)) {
      for (const scenario of scenarios) expect(found).toContainEqual([service, scenario]);
    }
  });

  it.each(listFixtures())("%s/%s has valid meta matching its directory", (service, scenario) => {
    const fixture = loadFixture(service, scenario);
    expect(validateMeta(fixture.meta, { service, scenario })).toEqual([]);
  });

  it.each(listFixtures())("%s/%s has a well-formed request and response", (service, scenario) => {
    const { request, response } = loadFixture(service, scenario);
    expect(request.method).toMatch(/^[A-Z]+$/);
    expect(request.url).toMatch(/^https:\/\//);
    expect(Number.isInteger(response.status)).toBe(true);
  });

  it("never contains a real-looking bearer token", () => {
    for (const f of loadAll()) {
      const auth = f.request.headers?.["authorization"];
      if (auth !== undefined) expect(auth).toMatch(/^Bearer <[A-Z_]+>$/);
    }
  });

  it("records the documented error statuses for the ledger", () => {
    expect(loadFixture("ledfra", "unbalanced-400").response.status).toBe(400);
    expect(loadFixture("ledfra", "guarded-422").response.status).toBe(422);
    expect(loadFixture("ledfra", "idempotency-conflict-409").response.status).toBe(409);
  });
});

describe("validateMeta", () => {
  const good = {
    service: "stitch",
    scenario: "x",
    description: "d",
    direction: "outbound",
    source: "recorded",
    references: [],
    capturedAt: "2026-10-24",
  };

  it("accepts a recorded fixture without a todo", () => {
    expect(validateMeta(good)).toEqual([]);
  });

  it("requires a todo on synthetic fixtures", () => {
    expect(validateMeta({ ...good, source: "synthetic-from-docs" })).toHaveLength(1);
  });

  it("rejects an unknown source, a bad date and a directory mismatch", () => {
    const problems = validateMeta(
      { ...good, source: "guess", capturedAt: "soon" },
      { service: "ledfra", scenario: "x" },
    );
    expect(problems).toHaveLength(3);
  });

  it("assertMeta throws with the problems", () => {
    expect(() => assertMeta({})).toThrow(/Invalid fixture meta/);
  });
});

describe("loader", () => {
  it("rejects path traversal in service and scenario", () => {
    expect(() => loadFixture("..", "x")).toThrow(/Invalid fixture service/);
    expect(() => loadFixture("stitch", "../ledfra/guarded-422")).toThrow(
      /Invalid fixture scenario/,
    );
  });

  it("reads from a custom root", () => {
    const root = mkdtempSync(join(tmpdir(), "fixtures-"));
    const dir = join(root, "demo", "one");
    mkdirSync(dir, { recursive: true });
    const meta = {
      service: "demo",
      scenario: "one",
      description: "d",
      direction: "outbound",
      source: "recorded",
      references: [],
      capturedAt: "2026-10-24",
    };
    writeFileSync(join(dir, "meta.json"), JSON.stringify(meta));
    writeFileSync(
      join(dir, "request.json"),
      JSON.stringify({ method: "GET", url: "https://x.test/" }),
    );
    writeFileSync(join(dir, "response.json"), JSON.stringify({ status: 204 }));
    expect(listFixtures(undefined, root)).toEqual([["demo", "one"]]);
    expect(loadFixture("demo", "one", root).response.status).toBe(204);
    expect(RECORDED_DIR).toMatch(/packages\/fixtures\/recorded$/);
  });
});

describe("createReplayFetch", () => {
  const create = loadFixture("stitch", "create-payment-request");
  const post = loadFixture("ledfra", "post-transaction");

  it("answers a matching request from the fixture", async () => {
    const fetchFn = createReplayFetch([create]);
    const res = await fetchFn(create.request.url, {
      method: "POST",
      headers: create.request.headers,
      body: JSON.stringify(create.request.body),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(create.response.body);
    expect(fetchFn.calls).toEqual([{ method: "POST", url: create.request.url }]);
  });

  it("ignores key order in the request body", async () => {
    const fetchFn = createReplayFetch([post]);
    const body = post.request.body as Record<string, unknown>;
    const reordered = Object.fromEntries(Object.entries(body).reverse());
    const res = await fetchFn(post.request.url, {
      method: "POST",
      headers: post.request.headers,
      body: JSON.stringify(reordered),
    });
    expect(res.status).toBe(201);
  });

  it("refuses a body that was never recorded", async () => {
    const fetchFn = createReplayFetch([post]);
    const body = { ...(post.request.body as object), description: "something else" };
    await expect(
      fetchFn(post.request.url, {
        method: "POST",
        headers: post.request.headers,
        body: JSON.stringify(body),
      }),
    ).rejects.toBeInstanceOf(NoFixtureMatchError);
  });

  it("requires the recorded Idempotency-Key", async () => {
    const fetchFn = createReplayFetch([post]);
    await expect(
      fetchFn(post.request.url, {
        method: "POST",
        headers: { "idempotency-key": "different" },
        body: JSON.stringify(post.request.body),
      }),
    ).rejects.toBeInstanceOf(NoFixtureMatchError);
  });

  it("serves the error statuses as responses, not exceptions", async () => {
    const bad = loadFixture("ledfra", "unbalanced-400");
    const fetchFn = createReplayFetch([bad]);
    const res = await fetchFn(bad.request.url, {
      method: "POST",
      headers: bad.request.headers,
      body: JSON.stringify(bad.request.body),
    });
    expect(res.status).toBe(400);
  });

  it("does not serve inbound fixtures", async () => {
    const hook = loadFixture("stitch", "payment-completed-webhook");
    const fetchFn = createReplayFetch([hook]);
    await expect(
      fetchFn(hook.request.url, { method: "POST", body: JSON.stringify(hook.request.body) }),
    ).rejects.toBeInstanceOf(NoFixtureMatchError);
  });
});
