// Hardening of the Node's sync (story 3.5 review): strangers cannot use up the Node's resources, first use is
// shared, a member reads its own appends, responses and bodies are bounded, and the routes answer 503 when the
// record is off. The harness is `buildApp` over a real Autobase record in a temp data folder, called with
// `inject`, so the routes, the gate and the hub run as they do in production.
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import {
  checkInvitation,
  createCommunity,
  joinCommunity,
  signRequest,
  type Community,
  type RequestParts,
} from "@shopong/community";
import { createEvent, webCryptoSha512 } from "@shopong/events";
import {
  connectSpaces,
  openAutobaseRecord,
  type AutobaseSharedRecord,
} from "@shopong/record-autobase";
import { afterAll, describe, expect, it } from "vite-plus/test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.ts";
import { ReplicaHub } from "./hub.ts";
import { createLogger } from "./logger.ts";
import { nodeDid } from "./record.ts";
import { closeInOrder, startNode, type RunningNode } from "./node.ts";
import { captureSink, FAKE_SECRETS } from "./testing/capture.ts";
import { phone, randomHex, T0, type Phone } from "./testing/community.ts";

const folders: string[] = [];
const freshFolder = (): string => {
  const folder = mkdtempSync(join(tmpdir(), "ocn-sync-hardening-"));
  folders.push(folder);
  return folder;
};
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

const MASTER = Buffer.from(FAKE_SECRETS.RECORD_MASTER_KEY, "hex");
const LONG = 60 * 60_000;

interface Harness {
  readonly dir: string;
  readonly auth: IsoUcanCapabilityAuth;
  readonly record: AutobaseSharedRecord<unknown>;
  readonly hub: ReplicaHub;
  readonly app: FastifyInstance;
  readonly opens: Map<string, number>;
  indexerOpens: number;
  close(): Promise<void>;
}

interface HarnessOptions {
  readonly dir?: string;
  readonly maxNonces?: number;
  readonly connect?: ConstructorParameters<typeof ReplicaHub>[0]["connect"];
  readonly connectOptions?: ConstructorParameters<typeof ReplicaHub>[0]["connectOptions"];
  readonly readWaitMs?: number;
  readonly openRecord?: ConstructorParameters<typeof ReplicaHub>[0]["openRecord"];
}

async function harness(options: HarnessOptions = {}): Promise<Harness> {
  const dir = options.dir ?? freshFolder();
  const auth = new IsoUcanCapabilityAuth();
  const real = await openAutobaseRecord<unknown>({
    local: nodeDid(MASTER),
    dataDir: join(dir, "record"),
    masterKey: MASTER,
  });
  const h = { indexerOpens: 0 } as Harness;
  const opens = new Map<string, number>();
  // Counts every open of the indexer and of each member's record, so a test can assert one open per replica.
  const indexer = {
    ...real,
    open: (...args: Parameters<typeof real.open>) => {
      h.indexerOpens++;
      return real.open(...args);
    },
  } as AutobaseSharedRecord<unknown>;
  const openRecord: typeof openAutobaseRecord = async (o) => {
    opens.set(o.local, (opens.get(o.local) ?? 0) + 1);
    return options.openRecord ? options.openRecord(o) : openAutobaseRecord(o);
  };
  const hub = new ReplicaHub({
    dataDir: dir,
    masterKey: MASTER,
    indexer,
    auth,
    openRecord,
    ...(options.connect === undefined ? {} : { connect: options.connect }),
    ...(options.connectOptions === undefined ? {} : { connectOptions: options.connectOptions }),
    ...(options.readWaitMs === undefined ? {} : { readWaitMs: options.readWaitMs }),
  });
  const app = buildApp({
    logger: createLogger({ level: "silent", sink: captureSink() }),
    version: "test",
    components: [],
    auth,
    sync: {
      hub,
      now: () => T0 + 1,
      ...(options.maxNonces === undefined ? {} : { maxNonces: options.maxNonces }),
    },
  });
  await app.ready();
  Object.assign(h, {
    dir,
    auth,
    record: real,
    hub,
    app,
    opens,
    close: async () => {
      await app.close();
      await hub.close();
      await real.close();
    },
  });
  return h;
}

/** A community founded by a creator on the Node, with the creator's replica joined to the indexer. */
async function found(h: Harness): Promise<{ creator: Phone; community: Community }> {
  const creator = await phone();
  const made = await createCommunity(
    creator.deps,
    await h.hub.recordOf(creator.did),
    "Stokvel",
    T0,
  );
  if (!made.ok) throw new Error(made.error.message);
  await h.hub.register(made.value);
  return { creator, community: made.value };
}

/** Invites `who` and joins them through their replica on the Node, so they are an admitted writer. */
async function joinAs(h: Harness, founder: Community, who: Phone): Promise<void> {
  const invited = await founder.invite(who.did, T0);
  if (!invited.ok) throw new Error(invited.error.message);
  await h.hub.admitMember(founder.key, who.did);
  const space = await h.hub.replicaOf(who.did, founder.key);
  if (space === undefined) throw new Error("no replica for the member");
  await h.hub.catchUp(founder.key);
  for (let i = 0; i < 500 && !(await space.writable()); i++) {
    await space.update();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const checked = await checkInvitation({
    auth: who.auth,
    text: invited.value.code,
    me: who.did,
    now: T0,
  });
  if (!checked.ok) throw new Error(checked.error.message);
  const joined = await joinCommunity(who.deps, space, checked.value, T0);
  if (!joined.ok) throw new Error(joined.error.message);
  await h.hub.catchUp(founder.key);
}

function eventBy(key: string, who: Phone, tag: string, size = 40) {
  return createEvent({
    type: "member.joined",
    space: key,
    actor: who.did,
    proof: [],
    claimedAt: T0,
    nonce: randomHex(16),
    payload: { invitation: `${tag}-${"x".repeat(size)}` },
  });
}

async function signedHeaders(signer: Phone, method: string, url: string, body = "") {
  const parts: RequestParts = {
    method,
    path: url,
    body,
    nonce: randomHex(16),
    time: T0 + 1,
    actor: signer.did,
  };
  const signed = await signRequest(signer.auth, parts, webCryptoSha512);
  if (!signed.ok) throw new Error(signed.error.message);
  return signed.value as unknown as Record<string, string>;
}

/** The signed request, with the Node's clock at T0 + 1 (see `clock` in the harness options: the default is the real clock). */
async function send(
  app: FastifyInstance,
  signer: Phone,
  method: "GET" | "POST",
  url: string,
  body?: unknown,
) {
  const text = body === undefined ? "" : JSON.stringify(body);
  const headers = await signedHeaders(signer, method, url, text);
  return app.inject({
    method,
    url,
    headers: { ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { payload: text }),
  });
}

/**
 * The names of every file and folder under the data folder, and the registry's text. Sizes are not compared:
 * replication in the background may still be writing the replicas a few bytes at a time.
 */
function snapshot(dir: string): string {
  const out: string[] = [];
  const walk = (folder: string) => {
    for (const name of readdirSync(folder).sort()) {
      const path = join(folder, name);
      out.push(path.slice(dir.length));
      if (statSync(path).isDirectory()) walk(path);
    }
  };
  walk(dir);
  out.push(`registry ${readFileSync(join(dir, "communities.json"), "utf8")}`);
  return out.join("\n");
}

describe("sync hardening (story 3.5 review)", () => {
  it(
    "a stranger's requests do not use up the one-time numbers a member needs",
    async () => {
      const h = await harness({ maxNonces: 20 });
      try {
        const { creator, community } = await found(h);
        const member = await phone();
        await joinAs(h, community, member);
        const stranger = await phone();
        for (let i = 0; i < 200; i++) {
          const res =
            i % 2 === 0
              ? await send(h.app, stranger, "GET", `/spaces/${community.key}/events`)
              : await send(
                  h.app,
                  stranger,
                  "POST",
                  `/spaces/${community.key}/events`,
                  eventBy(community.key, stranger, `s${i}`),
                );
          expect(res.statusCode).toBe(403);
        }
        const mine = await send(
          h.app,
          member,
          "POST",
          `/spaces/${community.key}/events`,
          eventBy(community.key, member, "m"),
        );
        expect(mine.statusCode).toBe(200);
        expect(creator.did).toBeTruthy();
      } finally {
        await h.close();
      }
    },
    LONG,
  );

  it(
    "a thousand strangers leave the data folder and the registry unchanged",
    async () => {
      const h = await harness();
      try {
        const { community } = await found(h);
        await h.hub.catchUp(community.key);
        const before = snapshot(h.dir);
        const stranger = await phone();
        for (let i = 0; i < 500; i++) {
          const pull = await send(
            h.app,
            stranger,
            "GET",
            `/spaces/${community.key}/events?limit=1`,
          );
          expect(pull.statusCode).toBe(403);
          const write = await send(
            h.app,
            stranger,
            "POST",
            `/spaces/${community.key}/events`,
            eventBy(community.key, stranger, "s"),
          );
          expect(write.statusCode).toBe(403);
        }
        expect(snapshot(h.dir)).toBe(before);
      } finally {
        await h.close();
      }
    },
    LONG,
  );

  it(
    "two first requests at once share one open of the member's replica and of the indexer",
    async () => {
      const dir = freshFolder();
      const first = await harness({ dir });
      const { community } = await found(first);
      const member = await phone();
      await joinAs(first, community, member);
      await first.close();

      const h = await harness({ dir });
      try {
        // The first use of the member's replica and of the indexer, started at the same moment.
        const [replica, read] = await Promise.all([
          h.hub.replicaOf(member.did, community.key),
          h.hub.readSince(member.did, community.key, 0, 10),
        ]);
        expect(replica).toBeDefined();
        expect(read.ok).toBe(true);
        expect(h.opens.get(member.did)).toBe(1);
        expect(h.indexerOpens).toBe(1);
      } finally {
        await h.close();
      }
    },
    LONG,
  );

  it(
    "a join that fails once is rolled back, and a later call succeeds",
    async () => {
      let armed = false;
      const connect = (a: any, b: any, o: any) => {
        if (armed) {
          armed = false;
          throw new Error("pipe refused once");
        }
        return connectSpaces(a, b, o);
      };
      const h = await harness({ connect });
      try {
        const { community } = await found(h);
        const member = await phone();
        await h.hub.admitMember(community.key, member.did);
        armed = true;
        await expect(h.hub.replicaOf(member.did, community.key)).rejects.toThrow(
          "pipe refused once",
        );
        const space = await h.hub.replicaOf(member.did, community.key);
        expect(space).toBeDefined();
        expect(h.opens.get(member.did)).toBe(2);
      } finally {
        await h.close();
      }
    },
    LONG,
  );

  it(
    "a member reads its own acknowledged append even when the pipe to the indexer is slow",
    async () => {
      const pipe = { delayMs: 0 };
      const h = await harness({ connectOptions: pipe });
      try {
        const { community } = await found(h);
        const member = await phone();
        await joinAs(h, community, member);
        pipe.delayMs = 50;
        const event = eventBy(community.key, member, "own");
        const posted = await send(h.app, member, "POST", `/spaces/${community.key}/events`, event);
        expect(posted.statusCode).toBe(200);
        const pulled = await send(h.app, member, "GET", `/spaces/${community.key}/events`);
        expect(pulled.statusCode).toBe(200);
        expect(pulled.json().events.map((e: { id: string }) => e.id)).toContain(posted.json().id);
        expect(pulled.json().behind).toBe(false);
      } finally {
        await h.close();
      }
    },
    LONG,
  );

  it(
    "after a bounded wait, a pull says it is behind instead of waiting for ever",
    async () => {
      const pipe = { delayMs: 0 };
      const h = await harness({ connectOptions: pipe, readWaitMs: 300 });
      try {
        const { community } = await found(h);
        const member = await phone();
        await joinAs(h, community, member);
        pipe.delayMs = 5_000;
        const posted = await send(
          h.app,
          member,
          "POST",
          `/spaces/${community.key}/events`,
          eventBy(community.key, member, "late"),
        );
        expect(posted.statusCode).toBe(200);
        const started = Date.now();
        const pulled = await send(h.app, member, "GET", `/spaces/${community.key}/events`);
        expect(Date.now() - started).toBeLessThan(2_000);
        expect(pulled.statusCode).toBe(200);
        expect(pulled.json().behind).toBe(true);
      } finally {
        await h.close();
      }
    },
    LONG,
  );

  it(
    "a pull response is capped by bytes, always has at least one event, and the cursor continues it",
    async () => {
      const h = await harness();
      try {
        const { community } = await found(h);
        const member = await phone();
        await joinAs(h, community, member);
        const sent: string[] = [];
        for (let i = 0; i < 30; i++) {
          const res = await send(
            h.app,
            member,
            "POST",
            `/spaces/${community.key}/events`,
            eventBy(community.key, member, `big${i}`, 55_000),
          );
          expect(res.statusCode).toBe(200);
          sent.push(res.json().id);
        }
        const seen: string[] = [];
        let after = "";
        for (let page = 0; page < 40 && seen.length < sent.length; page++) {
          const res = await send(
            h.app,
            member,
            "GET",
            `/spaces/${community.key}/events?after=${after}&limit=500`,
          );
          expect(res.statusCode).toBe(200);
          expect(res.body.length).toBeLessThanOrEqual(1024 * 1024 + 64 * 1024);
          const ids = res.json().events.map((e: { id: string }) => e.id);
          expect(ids.length).toBeGreaterThan(0);
          seen.push(...ids);
          after = res.json().next;
        }
        expect(new Set(seen).size).toBe(seen.length);
        for (const id of sent) expect(seen).toContain(id);
      } finally {
        await h.close();
      }
    },
    LONG,
  );

  it(
    "refuses a body over 64 KiB with 413",
    async () => {
      const h = await harness();
      try {
        const { community } = await found(h);
        const member = await phone();
        await joinAs(h, community, member);
        const res = await send(
          h.app,
          member,
          "POST",
          `/spaces/${community.key}/events`,
          eventBy(community.key, member, "huge", 70_000),
        );
        expect(res.statusCode).toBe(413);
      } finally {
        await h.close();
      }
    },
    LONG,
  );

  it("answers 503 on every sync route when the record is off", async () => {
    const app = buildApp({
      logger: createLogger({ level: "silent", sink: captureSink() }),
      version: "test",
      components: [],
      sync: {},
    });
    try {
      const auth = new IsoUcanCapabilityAuth();
      const who = await phone();
      const key = randomHex(32);
      const post = await app.inject({
        method: "POST",
        url: `/spaces/${key}/events`,
        payload: "{}",
        headers: { "content-type": "application/json" },
      });
      expect(post.statusCode).toBe(503);
      expect(post.json().reason).toBe("The Node record is not running.");
      const pull = await app.inject({
        method: "GET",
        url: `/spaces/${key}/events`,
        headers: await signedHeaders(who, "GET", `/spaces/${key}/events`),
      });
      expect(pull.statusCode).toBe(503);
      expect(auth).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it(
    "refuses an append by a member the record does not admit as a writer, with 403 not_writable",
    async () => {
      const h = await harness();
      try {
        const { community } = await found(h);
        const notWriter = await phone();
        await h.hub.admitMember(community.key, notWriter.did);
        const res = await send(
          h.app,
          notWriter,
          "POST",
          `/spaces/${community.key}/events`,
          eventBy(community.key, notWriter, "nw"),
        );
        expect(res.statusCode).toBe(403);
        expect(res.json().problem).toBe("not_writable");
      } finally {
        await h.close();
      }
    },
    LONG,
  );

  it(
    "a signature covers the query string: changing `after` breaks it",
    async () => {
      const h = await harness();
      try {
        const { community } = await found(h);
        const member = await phone();
        await joinAs(h, community, member);
        const headers = await signedHeaders(
          member,
          "GET",
          `/spaces/${community.key}/events?after=`,
        );
        const res = await h.app.inject({
          method: "GET",
          url: `/spaces/${community.key}/events?after=zzz`,
          headers,
        });
        expect(res.statusCode).toBe(401);
        expect(res.json().problem).toBe("unsigned");
      } finally {
        await h.close();
      }
    },
    LONG,
  );

  it(
    "a stranger gets 403 on the change notice and receives no stream",
    async () => {
      const h = await harness();
      try {
        const { community } = await found(h);
        const stranger = await phone();
        const res = await send(h.app, stranger, "GET", `/spaces/${community.key}/changes`);
        expect(res.statusCode).toBe(403);
        expect(res.body).not.toContain("event:");
      } finally {
        await h.close();
      }
    },
    LONG,
  );

  it(
    "keeps at most three change-notice connections per member, closing the oldest",
    async () => {
      const h = await harness();
      const listening = await h.app.listen({ host: "127.0.0.1", port: 0 });
      try {
        const { community } = await found(h);
        const member = await phone();
        await joinAs(h, community, member);
        const url = `${listening}/spaces/${community.key}/changes`;
        const readers = [];
        for (let i = 0; i < 4; i++) {
          const res = await fetch(url, {
            headers: await signedHeaders(member, "GET", `/spaces/${community.key}/changes`),
          });
          expect(res.status).toBe(200);
          readers.push(res.body!.getReader());
        }
        const first = await readers[0]!.read();
        const ended =
          first.done === true ||
          (first.value !== undefined && new TextDecoder().decode(first.value).includes("retry"));
        expect(ended).toBe(true);
        for (const r of readers) await r.cancel().catch(() => undefined);
      } finally {
        await h.close();
      }
    },
    LONG,
  );

  it(
    "registering again keeps every member already on the list",
    async () => {
      const h = await harness();
      try {
        const { creator, community } = await found(h);
        const member = await phone();
        await h.hub.admitMember(community.key, member.did);
        await h.hub.register(community);
        expect(await h.hub.isMember(member.did, community.key)).toBe(true);
        expect(await h.hub.isMember(creator.did, community.key)).toBe(true);
      } finally {
        await h.close();
      }
    },
    LONG,
  );

  it("a registry file that cannot be read is refused at start with a plain error naming the file", async () => {
    const dir = freshFolder();
    writeFileSync(join(dir, "communities.json"), "{ not json");
    await expect(
      startNode({
        env: {
          OCN_NODE_PORT: "0",
          OCN_NODE_DATA_DIR: dir,
          RECORD_MASTER_KEY: FAKE_SECRETS.RECORD_MASTER_KEY,
        },
        sink: captureSink(),
      }),
    ).rejects.toThrow(/communities\.json/u);
    expect(readFileSync(join(dir, "communities.json"), "utf8")).toBe("{ not json");
  });

  it("closes the record even when stopping the hub throws, and rethrows the first failure", async () => {
    const order: string[] = [];
    await expect(
      closeInOrder([
        async () => {
          order.push("app");
        },
        async () => {
          order.push("hub");
          throw new Error("hub failed");
        },
        async () => {
          order.push("record");
        },
      ]),
    ).rejects.toThrow("hub failed");
    expect(order).toEqual(["app", "hub", "record"]);
  });

  it("releases the record when the port is taken, so the data folder opens again", async () => {
    const dir = freshFolder();
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", () => resolve()));
    const taken = (blocker.address() as { port: number }).port;
    try {
      await expect(
        startNode({
          env: {
            OCN_NODE_PORT: String(taken),
            OCN_NODE_DATA_DIR: dir,
            RECORD_MASTER_KEY: FAKE_SECRETS.RECORD_MASTER_KEY,
          },
          sink: captureSink(),
        }),
      ).rejects.toThrow();
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
    const node: RunningNode = await startNode({
      env: {
        OCN_NODE_PORT: "0",
        OCN_NODE_DATA_DIR: dir,
        RECORD_MASTER_KEY: FAKE_SECRETS.RECORD_MASTER_KEY,
      },
      sink: captureSink(),
    });
    await node.close();
  });
});
