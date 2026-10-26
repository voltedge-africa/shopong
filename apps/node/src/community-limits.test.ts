// Limits on who may create communities on a Node, and how many (review N1, N2). The allow-list and the global cap are
// checked before the one-time number is claimed and before anything is stored or opened. Each community route has its
// own one-time-number table, so filling one does not starve the other.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  issueInvitation,
  newCommunityKey,
  signRequest,
  type RequestParts,
} from "@shopong/community";
import { webCryptoSha512 } from "@shopong/events";
import type { CapabilityAuth, Did, ViewReader } from "@shopong/ports";
import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import { describe, expect, it } from "vite-plus/test";
import { buildApp } from "./app.ts";
import type { CommunityHub } from "./community-routes.ts";
import type { CommunityReservation } from "./hub.ts";
import { createLogger } from "./logger.ts";
import { startNode, type RunningNode } from "./node.ts";
import { captureSink, FAKE_SECRETS } from "./testing/capture.ts";
import { phone, randomHex, type Phone } from "./testing/community.ts";

const randomKey = (): string => newCommunityKey((n) => crypto.getRandomValues(new Uint8Array(n)));

/** A hub that records every call. Nothing is stored. */
function spyHub(reserve: CommunityReservation = "reserved") {
  const calls: string[] = [];
  const registered = new Map<string, Did>();
  const hub: CommunityHub = {
    reserveCommunity: (creator, key) => {
      calls.push(`reserve:${creator}:${key}`);
      return reserve;
    },
    releaseCommunity: () => calls.push("release"),
    createCommunity: async (key, creator) => {
      calls.push(`create:${key}`);
      registered.set(key, creator);
      return `space-${key}`;
    },
    registrationOf: (key) => {
      const creator = registered.get(key);
      return creator === undefined ? undefined : { spaceKey: `space-${key}`, creator };
    },
    indexedView: async (): Promise<ViewReader> => ({
      get: async () => undefined,
      list: async () => [],
    }),
    admitMember: async (key, did) => {
      calls.push(`admit:${key}:${did}`);
    },
  };
  return { hub, calls, registered };
}

async function signed(
  auth: CapabilityAuth,
  who: Phone,
  method: "POST" | "GET",
  path: string,
  body: unknown,
): Promise<{ headers: Record<string, string>; payload: string }> {
  const payload = body === undefined ? "" : JSON.stringify(body);
  const parts: RequestParts = {
    method,
    path,
    body: payload,
    nonce: randomHex(16),
    time: Date.now(),
    actor: who.did,
  };
  const signedOk = await signRequest(auth, parts, webCryptoSha512);
  if (!signedOk.ok) throw new Error(signedOk.error.message);
  return {
    headers: {
      ...(signedOk.value as unknown as Record<string, string>),
      "content-type": "application/json",
    },
    payload,
  };
}

function logger() {
  return createLogger({ level: "silent", sink: captureSink() });
}

describe("who may create a community: the allow-list (review N1b)", () => {
  it("refuses a stranger before the one-time number is claimed, and opens nothing", async () => {
    const { hub, calls } = spyHub();
    const allowed = await phone();
    const stranger = await phone();
    const app = buildApp({
      logger: logger(),
      version: "test",
      components: [],
      communities: hub,
      allowedCreators: [allowed.did],
    });
    const body = { key: randomKey() };
    const req = await signed(stranger.auth, stranger, "POST", "/communities", body);
    const res = await app.inject({
      method: "POST",
      url: "/communities",
      headers: req.headers,
      payload: req.payload,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().problem).toBe("not_allowed");
    expect(calls).toEqual([]);
    await app.close();
  });

  it("lets a listed creator through to the hub", async () => {
    const { hub, calls } = spyHub();
    const allowed = await phone();
    const app = buildApp({
      logger: logger(),
      version: "test",
      components: [],
      communities: hub,
      allowedCreators: [allowed.did],
    });
    const body = { key: randomKey() };
    const req = await signed(allowed.auth, allowed, "POST", "/communities", body);
    const res = await app.inject({
      method: "POST",
      url: "/communities",
      headers: req.headers,
      payload: req.payload,
    });
    expect(res.statusCode).toBe(200);
    expect(calls[0]).toMatch(/^reserve:/u);
    await app.close();
  });

  it("an empty allow-list is open (development use only)", async () => {
    const { hub, calls } = spyHub();
    const anyone = await phone();
    const app = buildApp({ logger: logger(), version: "test", components: [], communities: hub });
    const body = { key: randomKey() };
    const req = await signed(anyone.auth, anyone, "POST", "/communities", body);
    const res = await app.inject({
      method: "POST",
      url: "/communities",
      headers: req.headers,
      payload: req.payload,
    });
    expect(res.statusCode).toBe(200);
    expect(calls.length).toBeGreaterThan(0);
    await app.close();
  });
});

describe("the Node's global cap (review N1a)", () => {
  it("refuses a new community with a plain reason when the Node is full", async () => {
    const { hub, calls } = spyHub("node_full");
    const who = await phone();
    const app = buildApp({ logger: logger(), version: "test", components: [], communities: hub });
    const body = { key: randomKey() };
    const req = await signed(who.auth, who, "POST", "/communities", body);
    const res = await app.inject({
      method: "POST",
      url: "/communities",
      headers: req.headers,
      payload: req.payload,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().problem).toBe("node_full");
    expect(res.json().reason).toBe("This Node has reached the most communities it will host.");
    expect(calls.filter((c) => c.startsWith("create:"))).toEqual([]);
    await app.close();
  });

  it("with a real Node: the second community is refused once the configured maximum is reached", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ocn-cap-"));
    let node: RunningNode | undefined;
    try {
      node = await startNode({
        env: {
          OCN_NODE_PORT: "0",
          OCN_NODE_DATA_DIR: dir,
          RECORD_MASTER_KEY: FAKE_SECRETS.RECORD_MASTER_KEY,
          OCN_NODE_MAX_COMMUNITIES: "1",
        },
        sink: captureSink(),
      });
      const first = await phone();
      const second = await phone();
      const post = async (who: Phone) => {
        const body = { key: randomKey() };
        const req = await signed(who.auth, who, "POST", "/communities", body);
        return fetch(`${node!.url}/communities`, {
          method: "POST",
          headers: req.headers,
          body: req.payload,
        });
      };
      expect((await post(first)).status).toBe(200);
      const refused = await post(second);
      expect(refused.status).toBe(403);
      expect(((await refused.json()) as { problem: string }).problem).toBe("node_full");
    } finally {
      await node?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("one-time-number tables of the community routes (review N2)", () => {
  it("a full table for creating communities does not refuse a member's admission", async () => {
    const { hub, registered } = spyHub();
    const creator = await phone();
    const joiner = await phone();
    const key = randomKey();
    registered.set(key, creator.did);
    const app = buildApp({
      logger: logger(),
      version: "test",
      components: [],
      communities: hub,
      communityNonces: { create: 1, members: 100 },
    });
    // Use up the single create-table slot with one allowed creation.
    const first = await signed(creator.auth, creator, "POST", "/communities", { key: randomKey() });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/communities",
          headers: first.headers,
          payload: first.payload,
        })
      ).statusCode,
    ).toBe(200);
    const second = await signed(creator.auth, creator, "POST", "/communities", {
      key: randomKey(),
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/communities",
          headers: second.headers,
          payload: second.payload,
        })
      ).statusCode,
    ).toBe(429);

    const issued = await issueInvitation({
      auth: creator.auth as IsoUcanCapabilityAuth,
      creator: creator.did,
      spaceKey: key,
      invitee: joiner.did,
      now: Date.now(),
    });
    if (!issued.ok) throw new Error(issued.error.message);
    const admit = await signed(joiner.auth, joiner, "POST", `/communities/${key}/members`, {
      invitation: issued.value.link,
    });
    const res = await app.inject({
      method: "POST",
      url: `/communities/${key}/members`,
      headers: admit.headers,
      payload: admit.payload,
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
