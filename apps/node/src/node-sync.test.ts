// The Node's sync over real HTTP and the real Autobase record in a temp data folder (story 3.5). Phones sign
// each request with their own key; the Node keeps one replica per member and an indexer, and a restart reopens
// them all. Membership is made the way the community code makes it: an invitation, then a join through the
// member's replica on the Node.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkInvitation,
  createCommunity,
  joinCommunity,
  signRequest,
  type Community,
  type RequestParts,
} from "@shopong/community";
import { createEvent, webCryptoSha512 } from "@shopong/events";
import { afterAll, afterEach, describe, expect, it } from "vite-plus/test";
import { startNode, type RunningNode } from "./node.ts";
import { captureSink, FAKE_SECRETS } from "./testing/capture.ts";
import { phone, randomHex, T0, type Phone } from "./testing/community.ts";

const folders: string[] = [];
const freshFolder = (): string => {
  const folder = mkdtempSync(join(tmpdir(), "ocn-node-sync-"));
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

const envFor = (dataDir: string): Record<string, string> => ({
  OCN_NODE_PORT: "0",
  OCN_NODE_DATA_DIR: dataDir,
  RECORD_MASTER_KEY: FAKE_SECRETS.RECORD_MASTER_KEY,
});

async function start(dataDir: string): Promise<RunningNode> {
  running = await startNode({ env: envFor(dataDir), sink: captureSink() });
  return running;
}

/** Signs a request as `signer` and sends it over HTTP to the running Node. */
async function call(
  node: RunningNode,
  signer: Phone,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const text = body === undefined ? "" : JSON.stringify(body);
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
  const res = await fetch(`${node.url}${path}`, {
    method,
    headers: {
      ...(signed.value as unknown as Record<string, string>),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: text }),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

/** Makes `who` a member of the community: invited by the creator, then joined through the member's replica. */
async function admit(
  node: RunningNode,
  founder: Community,
  who: Phone,
  now: number,
): Promise<void> {
  const hub = node.hub!;
  const invited = await founder.invite(who.did, now);
  if (!invited.ok) throw new Error(invited.error.message);
  await hub.admitMember(founder.key, who.did);
  const space = await hub.replicaOf(who.did, founder.key);
  if (space === undefined) throw new Error("the Node holds no replica for the member");
  await hub.catchUp(founder.key);
  const checked = await checkInvitation({
    auth: who.auth,
    text: invited.value.code,
    me: who.did,
    now,
  });
  if (!checked.ok) throw new Error(checked.error.message);
  const joined = await joinCommunity(who.deps, space, checked.value, now);
  if (!joined.ok) throw new Error(joined.error.message);
  await hub.catchUp(founder.key);
}

/** A community on the Node's own record, with the creator and two members admitted. */
async function seed(node: RunningNode) {
  const hub = node.hub!;
  const creator = await phone();
  const joiner = await phone();
  const second = await phone();
  const made = await createCommunity(creator.deps, await hub.recordOf(creator.did), "Stokvel", T0);
  if (!made.ok) throw new Error(made.error.message);
  await hub.register(made.value);
  await admit(node, made.value, joiner, T0);
  await admit(node, made.value, second, T0);
  return { creator, joiner, second, key: made.value.key };
}

/** An event by `who`, for the community. Its id is the SHA-512 of the canonical JSON. */
function eventBy(key: string, who: Phone, tag: string) {
  return createEvent({
    type: "member.joined",
    space: key,
    actor: who.did,
    proof: [],
    claimedAt: T0,
    nonce: randomHex(16),
    payload: { invitation: tag },
  });
}

async function pullAll(node: RunningNode, signer: Phone, key: string, limit = 500) {
  const res = await call(node, signer, "GET", `/spaces/${key}/events?limit=${limit}`);
  return res;
}

describe("the Node's sync over the real record (AC 3.5)", () => {
  it("a phone that appended then pulls sees its own event", async () => {
    const node = await start(freshFolder());
    const { joiner, key } = await seed(node);
    const event = eventBy(key, joiner, "mine");
    const appended = await call(node, joiner, "POST", `/spaces/${key}/events`, event);
    expect(appended.status).toBe(200);
    expect(appended.json).toMatchObject({ duplicate: false });

    const pulled = await pullAll(node, joiner, key);
    expect(pulled.status).toBe(200);
    const ids = (pulled.json.events as { id: string }[]).map((e) => e.id);
    expect(ids).toContain(appended.json.id);
  });

  it("a second member's pull sees the first member's event", async () => {
    const node = await start(freshFolder());
    const { joiner, second, key } = await seed(node);
    const appended = await call(
      node,
      joiner,
      "POST",
      `/spaces/${key}/events`,
      eventBy(key, joiner, "from-joiner"),
    );
    expect(appended.status).toBe(200);

    const pulled = await pullAll(node, second, key);
    expect(pulled.status).toBe(200);
    const ids = (pulled.json.events as { id: string }[]).map((e) => e.id);
    expect(ids).toContain(appended.json.id);
  });

  it("a restart keeps both members' events, and both can still pull", async () => {
    const dir = freshFolder();
    let node = await start(dir);
    const { joiner, second, key } = await seed(node);
    const a = await call(node, joiner, "POST", `/spaces/${key}/events`, eventBy(key, joiner, "a"));
    const b = await call(node, second, "POST", `/spaces/${key}/events`, eventBy(key, second, "b"));
    expect([a.status, b.status]).toEqual([200, 200]);
    await node.close();
    running = undefined;

    node = await start(dir);
    for (const who of [joiner, second]) {
      const pulled = await pullAll(node, who, key);
      expect(pulled.status).toBe(200);
      const ids = (pulled.json.events as { id: string }[]).map((e) => e.id);
      expect(ids).toEqual(expect.arrayContaining([a.json.id, b.json.id]));
    }
  });

  it("after a stop that does not settle replication, a restart still serves the acknowledged events", async () => {
    const dir = freshFolder();
    let node = await start(dir);
    const { joiner, creator, second, key } = await seed(node);
    const a = await call(
      node,
      joiner,
      "POST",
      `/spaces/${key}/events`,
      eventBy(key, joiner, "crash"),
    );
    expect(a.status).toBe(200);
    // Stop without `hub.close()`, which would settle replication first: the HTTP server, the replicas, the record.
    await node.app.close();
    for (const who of [creator, joiner, second]) await node.hub!.releaseReplica(who.did);
    await node.record!.close();
    running = undefined;

    node = await start(dir);
    const pulled = await pullAll(node, second, key);
    const ids = (pulled.json.events as { id: string }[]).map((e) => e.id);
    expect(ids).toContain(a.json.id);
  });

  it("acknowledges an append only once it is durable: the acknowledged event is there after a reopen", async () => {
    const dir = freshFolder();
    let node = await start(dir);
    const { joiner, key } = await seed(node);
    const appended = await call(
      node,
      joiner,
      "POST",
      `/spaces/${key}/events`,
      eventBy(key, joiner, "durable"),
    );
    expect(appended.status).toBe(200);
    await node.close();
    running = undefined;

    node = await start(dir);
    const pulled = await pullAll(node, joiner, key);
    const ids = (pulled.json.events as { id: string }[]).map((e) => e.id);
    expect(ids).toContain(appended.json.id);
  });

  it("pages with the cursor the Node gives out, and a pull after the last cursor is empty", async () => {
    const node = await start(freshFolder());
    const { joiner, key } = await seed(node);
    const sent: string[] = [];
    for (const tag of ["p1", "p2", "p3"]) {
      const r = await call(
        node,
        joiner,
        "POST",
        `/spaces/${key}/events`,
        eventBy(key, joiner, tag),
      );
      sent.push(r.json.id as string);
    }
    const first = await pullAll(node, joiner, key, 2);
    const firstIds = (first.json.events as { id: string }[]).map((e) => e.id);
    const second = await call(
      node,
      joiner,
      "GET",
      `/spaces/${key}/events?after=${encodeURIComponent(first.json.next as string)}&limit=500`,
    );
    const secondIds = (second.json.events as { id: string }[]).map((e) => e.id);
    expect(secondIds.length).toBeGreaterThan(0);
    expect(
      firstIds.filter((id) => sent.includes(id)).length +
        secondIds.filter((id) => sent.includes(id)).length,
    ).toBe(3);

    const caughtUp = await call(
      node,
      joiner,
      "GET",
      `/spaces/${key}/events?after=${encodeURIComponent(second.json.next as string)}`,
    );
    expect(caughtUp.json.events).toEqual([]);
  });

  it("refuses a pull by someone who is not a member, and a cursor the Node did not give out", async () => {
    const node = await start(freshFolder());
    const { joiner, key } = await seed(node);
    const stranger = await phone();
    const refused = await call(node, stranger, "GET", `/spaces/${key}/events`);
    expect(refused.status).toBe(403);
    expect(refused.json).toMatchObject({ problem: "not_member" });

    const bad = await call(node, joiner, "GET", `/spaces/${key}/events?after=not-a-cursor`);
    expect(bad.status).toBe(400);
    expect(bad.json).toMatchObject({ problem: "invalid_cursor" });
  });

  it("sends a 'something changed' notice to a member's open connection when another member appends", async () => {
    const node = await start(freshFolder());
    const { joiner, second, key } = await seed(node);
    const path = `/spaces/${key}/changes`;
    const parts: RequestParts = {
      method: "GET",
      path,
      body: "",
      nonce: randomHex(16),
      time: Date.now(),
      actor: second.did,
    };
    const signed = await signRequest(second.auth, parts, webCryptoSha512);
    if (!signed.ok) throw new Error(signed.error.message);
    const stream = await fetch(`${node.url}${path}`, {
      headers: signed.value as unknown as Record<string, string>,
    });
    expect(stream.status).toBe(200);
    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();

    await call(node, joiner, "POST", `/spaces/${key}/events`, eventBy(key, joiner, "notice"));
    let text = "";
    const deadline = Date.now() + 10_000;
    while (!text.includes("event: changed") && Date.now() < deadline) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value);
    }
    await reader.cancel();
    expect(text).toContain("event: changed");
  });
});
