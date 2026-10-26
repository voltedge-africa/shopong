// The Node's signed community routes (story 3.4): `POST /communities` creates and registers a community with the
// creator as its first member, capped per creator DID; `POST /communities/:key/members` admits an invited person
// after `checkInvitation` on the Node's own view. Real HTTP, real Autobase record in a temp data folder.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  encodeProof,
  issueInvitation,
  newCommunityKey,
  signRequest,
  type RequestParts,
} from "@shopong/community";
import { createEvent, webCryptoSha512, eventIdOf } from "@shopong/events";
import { afterAll, afterEach, describe, expect, it } from "vite-plus/test";
import { COMMUNITY_LIMIT } from "./community-routes.ts";
import { startNode, type RunningNode } from "./node.ts";
import { captureSink, FAKE_SECRETS } from "./testing/capture.ts";
import { phone, randomHex, T0, type Phone } from "./testing/community.ts";

const folders: string[] = [];
const freshFolder = (): string => {
  const folder = mkdtempSync(join(tmpdir(), "ocn-node-communities-"));
  folders.push(folder);
  return folder;
};
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

let running: RunningNode | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

async function start(): Promise<RunningNode> {
  running = await startNode({
    env: {
      OCN_NODE_PORT: "0",
      OCN_NODE_DATA_DIR: freshFolder(),
      RECORD_MASTER_KEY: FAKE_SECRETS.RECORD_MASTER_KEY,
    },
    sink: captureSink(),
  });
  return running;
}

type Reply = { status: number; json: Record<string, unknown> };

/** A fresh community key: 64 random hex characters. */
const randomKey = (): string => newCommunityKey((n) => crypto.getRandomValues(new Uint8Array(n)));

/** Sends a request signed as `signer` (or unsigned when `signer` is undefined). */
async function call(
  node: RunningNode,
  signer: Phone | undefined,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  headersOverride?: Record<string, string>,
): Promise<Reply> {
  const text = body === undefined ? "" : JSON.stringify(body);
  let headers: Record<string, string> = {};
  if (signer !== undefined) {
    const parts: RequestParts = {
      method,
      path,
      body: text,
      nonce: randomHex(16),
      time: Date.now(),
      actor: signer.did,
    };
    const signed = await signRequest(signer.auth, parts, webCryptoSha512);
    if (!signed.ok) throw new Error(signed.error.message);
    headers = signed.value as unknown as Record<string, string>;
  }
  const res = await fetch(`${node.url}${path}`, {
    method,
    headers: {
      ...headers,
      ...headersOverride,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: text }),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const createCommunity = (node: RunningNode, who: Phone, key: string) =>
  call(node, who, "POST", "/communities", { key });

/** A member.joined / member.invited event by `who` for the community, with its id. */
async function eventOf(
  key: string,
  who: Phone,
  type: "member.joined" | "member.invited" | "member.removed",
  payload: Record<string, unknown>,
  proof: string[] = [],
  at = Date.now(),
) {
  const event = createEvent({
    type,
    space: key,
    actor: who.did,
    proof,
    claimedAt: at,
    nonce: randomHex(16),
    payload,
  } as never);
  return event;
}

/** Posts an event through the events route until the Node accepts it (a new member's replica can lag). */
async function post(node: RunningNode, who: Phone, key: string, event: unknown): Promise<Reply> {
  let last: Reply = { status: 0, json: {} };
  for (let i = 0; i < 100; i++) {
    last = await call(node, who, "POST", `/spaces/${key}/events`, event);
    if (last.status !== 403 || last.json.problem !== "not_writable") return last;
    await new Promise((r) => setTimeout(r, 50));
  }
  return last;
}

describe("POST /communities", () => {
  it("refuses an unsigned request before it reads the body", async () => {
    const node = await start();
    const reply = await call(node, undefined, "POST", "/communities", { key: "x" });
    expect(reply.status).toBe(401);
    expect(reply.json.problem).toBe("unsigned");
  });

  it("creates and registers the community for a signed creator, and says so plainly", async () => {
    const node = await start();
    const creator = await phone();
    const key = randomKey();
    const made = await createCommunity(node, creator, key);
    expect(made.status).toBe(200);
    expect(made.json.key).toBe(key);
    expect(typeof made.json.spaceKey).toBe("string");
    expect(made.json.duplicate).toBe(false);
    // The creator's own events are now accepted: the community is held and the creator is a member.
    const founder = await eventOf(key, creator, "member.joined", { invitation: "founder" });
    expect((await post(node, creator, key, founder)).status).toBe(200);
  });

  it("is idempotent for the same creator and the same key: no second community, no extra count", async () => {
    const node = await start();
    const creator = await phone();
    const key = randomKey();
    expect((await createCommunity(node, creator, key)).status).toBe(200);
    const again = await createCommunity(node, creator, key);
    expect(again.status).toBe(200);
    expect(again.json.duplicate).toBe(true);
  });

  it("refuses a key another person already registered, with a plain reason", async () => {
    const node = await start();
    const first = await phone();
    const other = await phone();
    const key = randomKey();
    expect((await createCommunity(node, first, key)).status).toBe(200);
    const taken = await createCommunity(node, other, key);
    expect(taken.status).toBe(409);
    expect(taken.json.problem).toBe("community_exists");
    expect(String(taken.json.reason)).toMatch(/already/u);
  });

  it("caps each creator at three communities; a fourth is refused with community_limit", async () => {
    expect(COMMUNITY_LIMIT).toBe(3);
    const node = await start();
    const creator = await phone();
    const keys = [0, 1, 2].map(() => randomKey());
    for (const key of keys) expect((await createCommunity(node, creator, key)).status).toBe(200);
    const fourth = await createCommunity(node, creator, randomKey());
    expect(fourth.status).toBe(403);
    expect(fourth.json.problem).toBe("community_limit");
    expect(String(fourth.json.reason)).toMatch(/three/u);
    // Another person is not held to this creator's count.
    const someone = await phone();
    const own = await createCommunity(node, someone, randomKey());
    expect(own.status).toBe(200);
  });

  it("refuses a malformed key with a plain reason", async () => {
    const node = await start();
    const creator = await phone();
    const reply = await createCommunity(node, creator, "not-a-key");
    expect(reply.status).toBe(400);
    expect(reply.json.problem).toBe("invalid_request");
  });

  it("refuses a replayed one-time number", async () => {
    const node = await start();
    const creator = await phone();
    const key = randomKey();
    const body = JSON.stringify({ key });
    const parts: RequestParts = {
      method: "POST",
      path: "/communities",
      body,
      nonce: randomHex(16),
      time: Date.now(),
      actor: creator.did,
    };
    const signed = await signRequest(creator.auth, parts, webCryptoSha512);
    if (!signed.ok) throw new Error("sign");
    const send = () =>
      fetch(`${node.url}/communities`, {
        method: "POST",
        headers: {
          ...(signed.value as unknown as Record<string, string>),
          "content-type": "application/json",
        },
        body,
      });
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(409);
  });
});

describe("POST /communities/:key/members", () => {
  /** A community with a creator who has registered it and written the founding event. */
  async function founded(node: RunningNode) {
    const creator = await phone();
    const key = randomKey();
    expect((await createCommunity(node, creator, key)).status).toBe(200);
    const founder = await eventOf(key, creator, "member.joined", { invitation: "founder" });
    expect((await post(node, creator, key, founder)).status).toBe(200);
    return { creator, key };
  }

  /** The creator invites `who`: the invitation is issued, and its member.invited event is written. */
  async function invite(
    node: RunningNode,
    creator: Phone,
    key: string,
    who: Phone,
    at = Date.now(),
  ) {
    const issued = await issueInvitation({
      auth: creator.auth,
      creator: creator.did,
      spaceKey: key,
      invitee: who.did,
      now: at,
    });
    if (!issued.ok) throw new Error(issued.error.message);
    const event = await eventOf(
      key,
      creator,
      "member.invited",
      { invitation: issued.value.id, invitee: who.did, expiresAt: issued.value.expiresAt },
      [],
      at,
    );
    expect((await post(node, creator, key, event)).status).toBe(200);
    return { link: issued.value.link, id: issued.value.id, token: issued.value.token };
  }

  it("admits an invited person, who can then write and read", async () => {
    const node = await start();
    const { creator, key } = await founded(node);
    const joiner = await phone();
    const { link, id, token } = await invite(node, creator, key, joiner);

    // Before admission the person is not held: a read is refused.
    expect((await call(node, joiner, "GET", `/spaces/${key}/events`)).status).toBe(403);
    const admitted = await call(node, joiner, "POST", `/communities/${key}/members`, {
      invitation: link,
    });
    expect(admitted.status).toBe(200);
    expect(admitted.json.admitted).toBe(true);
    const joined = await eventOf(key, joiner, "member.joined", { invitation: id }, [
      encodeProof(token),
    ]);
    expect((await post(node, joiner, key, joined)).status).toBe(200);
    const read = await call(node, joiner, "GET", `/spaces/${key}/events?after=`);
    expect(read.status).toBe(200);
  });

  /**
   * A joined member whom the creator then removes. The Node's indexer holds the removal before this returns. With
   * `alsoInvite`, the creator first issues a second invitation that is never used.
   */
  async function joinedThenRemoved(node: RunningNode, alsoInvite = false) {
    const { creator, key } = await founded(node);
    const joiner = await phone();
    const first = await invite(node, creator, key, joiner);
    const admitted = await call(node, joiner, "POST", `/communities/${key}/members`, {
      invitation: first.link,
    });
    expect(admitted.status).toBe(200);
    const joined = await eventOf(key, joiner, "member.joined", { invitation: first.id }, [
      encodeProof(first.token),
    ]);
    expect((await post(node, joiner, key, joined)).status).toBe(200);
    // Issued before the removal: a fresh invitation after it would clear the mark (story 3.3).
    const unused = alsoInvite ? await invite(node, creator, key, joiner) : undefined;
    const removal = await eventOf(key, creator, "member.removed", { member: joiner.did });
    expect((await post(node, creator, key, removal)).status).toBe(200);
    await node.hub!.catchUp(key);
    return { creator, key, joiner, unused };
  }

  it("refuses a removed member's old invitation that was never used, and keeps them off the Node's list", async () => {
    const node = await start();
    const { key, joiner, unused } = await joinedThenRemoved(node, true);
    const reply = await call(node, joiner, "POST", `/communities/${key}/members`, {
      invitation: unused!.link,
    });
    expect(reply.status).toBe(403);
    expect(reply.json.problem).toBe("removed");
    expect(await node.hub!.isMember(joiner.did, key)).toBe(false);
  });

  it("admits a removed member again on a fresh invitation, and their replica opens again", async () => {
    const node = await start();
    const { creator, key, joiner } = await joinedThenRemoved(node);
    const fresh = await invite(node, creator, key, joiner);
    await node.hub!.catchUp(key);
    const admitted = await call(node, joiner, "POST", `/communities/${key}/members`, {
      invitation: fresh.link,
    });
    expect(admitted.status).toBe(200);
    // The member's replica is opened and settled with the indexer before the join is sent (as the 3.5 tests do).
    await node.hub!.replicaOf(joiner.did, key);
    await node.hub!.catchUp(key);
    const rejoined = await eventOf(key, joiner, "member.joined", { invitation: fresh.id }, [
      encodeProof(fresh.token),
    ]);
    const jr = await post(node, joiner, key, rejoined);
    expect(jr.status).toBe(200);
    expect(await node.hub!.holdsReplica(joiner.did, key)).toBe(true);
  });

  it("refuses a stranger with no invitation, in plain words", async () => {
    const node = await start();
    const { key } = await founded(node);
    const stranger = await phone();
    const reply = await call(node, stranger, "POST", `/communities/${key}/members`, {
      invitation: "hello",
    });
    expect(reply.status).toBe(403);
    expect(String(reply.json.reason)).toMatch(/can't be checked/u);
  });

  it("refuses an invitation for someone else", async () => {
    const node = await start();
    const { creator, key } = await founded(node);
    const invitee = await phone();
    const other = await phone();
    const { link } = await invite(node, creator, key, invitee);
    const reply = await call(node, other, "POST", `/communities/${key}/members`, {
      invitation: link,
    });
    expect(reply.status).toBe(403);
    expect(reply.json.reason).toBe("This invitation is for someone else.");
  });

  it("refuses an expired invitation", async () => {
    const node = await start();
    const { creator, key } = await founded(node);
    const joiner = await phone();
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    const { link } = await invite(node, creator, key, joiner, eightDaysAgo);
    const reply = await call(node, joiner, "POST", `/communities/${key}/members`, {
      invitation: link,
    });
    expect(reply.status).toBe(403);
    expect(reply.json.reason).toBe("This invitation has expired.");
  });

  it("refuses an invitation signed by someone who is not the creator", async () => {
    const node = await start();
    const { key } = await founded(node);
    const forger = await phone();
    const joiner = await phone();
    const issued = await issueInvitation({
      auth: forger.auth,
      creator: forger.did,
      spaceKey: key,
      invitee: joiner.did,
      now: Date.now(),
    });
    if (!issued.ok) throw new Error(issued.error.message);
    const reply = await call(node, joiner, "POST", `/communities/${key}/members`, {
      invitation: issued.value.link,
    });
    expect(reply.status).toBe(403);
    expect(reply.json.problem).toBe("bad_invitation");
  });

  it("refuses an invitation already used by someone else", async () => {
    const node = await start();
    const { creator, key } = await founded(node);
    const first = await phone();
    const second = await phone();
    const { link, id, token } = await invite(node, creator, key, first);
    expect(
      (await call(node, first, "POST", `/communities/${key}/members`, { invitation: link })).status,
    ).toBe(200);
    const joined = await eventOf(key, first, "member.joined", { invitation: id }, [
      encodeProof(token),
    ]);
    expect((await post(node, first, key, joined)).status).toBe(200);
    // The same link, presented by someone else, is refused: it names the first person.
    const again = await call(node, second, "POST", `/communities/${key}/members`, {
      invitation: link,
    });
    expect(again.status).toBe(403);
    expect(again.json.problem).toBe("bad_invitation");
  });

  it("refuses an invitation for a community the Node does not hold", async () => {
    const node = await start();
    const someone = await phone();
    const reply = await call(node, someone, "POST", `/communities/${randomHex(32)}/members`, {
      invitation: "shopong://join?space=x",
    });
    expect(reply.status).toBe(404);
    expect(reply.json.problem).toBe("not_held");
  });

  it("does not change the admission of a person who was never invited", async () => {
    const node = await start();
    const { key } = await founded(node);
    const stranger = await phone();
    await call(node, stranger, "POST", `/communities/${key}/members`, {
      invitation: "shopong://join?space=" + key,
    });
    expect((await call(node, stranger, "GET", `/spaces/${key}/events`)).status).toBe(403);
  });
});

void eventIdOf;
void T0;

// Story 8.1: the creator's community name and rules note, written through the Node's events route.
describe("POST /spaces/:key/events: the community name (story 8.1)", () => {
  it("accepts a valid community.named from the creator, and the record gives it back to every member", async () => {
    const node = await start();
    const creator = await phone();
    const key = randomKey();
    expect((await createCommunity(node, creator, key)).status).toBe(200);
    const founder = await eventOf(key, creator, "member.joined", { invitation: "founder" });
    expect((await post(node, creator, key, founder)).status).toBe(200);

    const naming = createEvent({
      type: "community.named",
      space: key,
      actor: creator.did,
      proof: [],
      claimedAt: Date.now(),
      nonce: randomHex(16),
      payload: { name: "Ntombi Stokvel", rules: "We pay in on the first Friday." },
    } as never);
    const accepted = await post(node, creator, key, naming);
    expect(accepted.status).toBe(200);
    expect(accepted.json.id).toBe(await eventIdOf(naming, webCryptoSha512));

    const pulled = await call(node, creator, "GET", `/spaces/${key}/events?after=`);
    expect(pulled.status).toBe(200);
    // Each pulled entry carries the envelope under `event`.
    const events = pulled.json.events as { event?: { type?: string; payload?: unknown } }[];
    expect(events.map((entry) => entry.event)).toContainEqual(
      expect.objectContaining({
        type: "community.named",
        payload: { name: "Ntombi Stokvel", rules: "We pay in on the first Friday." },
      }),
    );
  });

  it("refuses a malformed community.named at the route, in plain words, and writes nothing", async () => {
    const node = await start();
    const creator = await phone();
    const key = randomKey();
    expect((await createCommunity(node, creator, key)).status).toBe(200);
    const founder = await eventOf(key, creator, "member.joined", { invitation: "founder" });
    expect((await post(node, creator, key, founder)).status).toBe(200);

    // A raw envelope, not built by `createEvent`, so the route's own check is what refuses it.
    const raw = {
      v: 1,
      type: "community.named",
      space: key,
      actor: creator.did,
      proof: [],
      claimedAt: Date.now(),
      nonce: randomHex(16),
      payload: { name: "N".repeat(81), rules: "" },
    };
    const refused = await call(node, creator, "POST", `/spaces/${key}/events`, raw);
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(refused.json)).not.toContain("N".repeat(81));
    const pulled = await call(node, creator, "GET", `/spaces/${key}/events?after=`);
    const types = (pulled.json.events as { event?: { type?: string } }[]).map((e) => e.event?.type);
    expect(types).not.toContain("community.named");
  });
});
