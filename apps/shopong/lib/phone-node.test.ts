/// <reference types="node" />
// Two phones and the real Node over HTTP (story 3.4). The Node runs as its own process, from its entry point, the way
// an operator starts it; the phone code is this app's own (client, sync service, queue, events). A community is
// created, a second person is invited and admitted, both write while apart, and they reconverge: one view on both
// phones, and every event in the Node's record once.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import { checkInvitation, issueInvitation, newCommunityKey } from "@shopong/community";
import { eventIdOf, webCryptoSha512 } from "@shopong/events";
import type { CapabilityAuth, Did } from "@shopong/ports";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { founderEvent, inviteEvent, joinEvent } from "./communityEvents";
import { createNodeClient, type NodeClient } from "./nodeClient";
import { memoryQueue } from "./offlineQueue";
import { createSyncService, type SyncService } from "./sync";

const MAIN = fileURLToPath(new URL("../../node/src/main.ts", import.meta.url));
const REGISTER = fileURLToPath(new URL("../../node/src/register.mjs", import.meta.url));

const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const now = () => Date.now();

let dir: string;
let child: ChildProcess | undefined;
let url = "";

/** Starts the Node's real entry point on a free port and waits for its "listening" line. */
function startProcess(): Promise<void> {
  dir = mkdtempSync(join(tmpdir(), "ocn-phone-node-"));
  // A fresh key for a throwaway data folder: the Node refuses placeholders, so it is random here.
  const env: Record<string, string> = {
    PATH: process.env["PATH"] ?? "",
    OCN_NODE_PORT: "0",
    OCN_NODE_HOST: "127.0.0.1",
    OCN_NODE_DATA_DIR: join(dir, "data"),
    OCN_NODE_LOG_LEVEL: "info",
    RECORD_MASTER_KEY: Array.from(randomBytes(32), (b) => b.toString(16).padStart(2, "0")).join(""),
  };
  child = spawn(process.execPath, ["--import", REGISTER, MAIN], {
    env: env as unknown as NodeJS.ProcessEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("the Node did not start")), 30_000);
    child!.stdout!.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      for (const line of buffer.split("\n")) {
        if (!line.includes("ocn node listening")) continue;
        const parsed = JSON.parse(line) as { url: string };
        url = parsed.url;
        clearTimeout(timer);
        resolve();
      }
    });
    child!.on("exit", (code: number | null) =>
      reject(new Error(`the Node exited with ${String(code)}`)),
    );
  });
}

async function stopProcess(): Promise<void> {
  if (child === undefined || child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => child!.once("exit", () => resolve()));
  child.kill("SIGTERM");
  await exited;
}

beforeAll(async () => {
  await startProcess();
});
afterAll(async () => {
  await stopProcess();
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

interface Phone {
  auth: CapabilityAuth;
  did: Did;
}

async function phone(): Promise<Phone> {
  const auth = new IsoUcanCapabilityAuth();
  return { auth, did: await auth.createIdentity() };
}

/** A phone's client and sync service, as the app builds them: its identity signs, the queue is memory. */
function phoneSync(who: Phone): { client: NodeClient; sync: SyncService } {
  const client = createNodeClient({ baseUrl: url, auth: who.auth, did: who.did, randomBytes });
  const sync = createSyncService({ node: client, queue: memoryQueue(), auth: who.auth, now });
  return { client, sync };
}

/** Flushes until the queue is empty, the way the app retries (short waits; the Node answers `waiting` until admitted). */
async function drain(sync: SyncService): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const state = await sync.flush();
    if (state.result === "connected" && state.pending === 0) return;
    if (state.result === "refused") throw new Error(`refused: ${state.refusal ?? ""}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("the queue did not drain");
}

describe("two phones and the Node (story 3.4)", () => {
  it("creates, invites, admits, writes apart, reconverges: one view on both phones, each event once", async () => {
    const creator = await phone();
    const joiner = await phone();
    const key = newCommunityKey(randomBytes);
    const a = phoneSync(creator);
    const b = phoneSync(joiner);
    const ref = { key, creator: creator.did };

    // The creator's phone registers the community on the Node, then queues the founding event and sends it.
    const made = await a.client.createCommunity(key);
    if (!made.ok) throw new Error(made.failure.reason);
    const founder = founderEvent({ community: key, me: creator.did, now: now(), randomBytes });
    expect((await a.sync.enqueue(key, founder)).ok).toBe(true);
    await drain(a.sync);

    // The creator invites the joiner: the invitation is issued, and its event is queued and sent.
    const issued = await issueInvitation({
      auth: creator.auth,
      creator: creator.did,
      spaceKey: key,
      invitee: joiner.did,
      now: now(),
    });
    if (!issued.ok) throw new Error(issued.error.message);
    await a.sync.enqueue(
      key,
      inviteEvent({
        community: key,
        me: creator.did,
        now: now(),
        randomBytes,
        invitation: issued.value,
      }),
    );
    await drain(a.sync);

    // The joiner's phone checks the link, asks the Node to admit it, then queues and sends its join.
    const checked = await checkInvitation({
      auth: joiner.auth,
      text: issued.value.link,
      me: joiner.did,
      now: now(),
    });
    if (!checked.ok) throw new Error(checked.error.message);
    expect((await b.client.admitMember(key, issued.value.link)).ok).toBe(true);
    await b.sync.enqueue(
      key,
      joinEvent({
        community: key,
        me: joiner.did,
        now: now(),
        randomBytes,
        checked: checked.value,
      }),
    );
    await drain(b.sync);

    // The creator writes a second invitation while apart from the Node: it waits on the phone as "on your phone".
    const third = await phone();
    const issued2 = await issueInvitation({
      auth: creator.auth,
      creator: creator.did,
      spaceKey: key,
      invitee: third.did,
      now: now(),
    });
    if (!issued2.ok) throw new Error(issued2.error.message);
    const queued = await a.sync.enqueue(
      key,
      inviteEvent({
        community: key,
        me: creator.did,
        now: now(),
        randomBytes,
        invitation: issued2.value,
      }),
    );
    if (!queued.ok) throw new Error(queued.reason);
    expect(a.sync.markOf(key, queued.id)).toBe("on_phone");

    // Both reconnect and pull: one view, and the Node holds each event once.
    await drain(a.sync);
    await a.sync.pull(ref);
    await b.sync.pull(ref);
    const text = (view: ReadonlyMap<string, unknown> | undefined) =>
      JSON.stringify([...(view ?? new Map()).entries()].sort(([x], [y]) => (x < y ? -1 : 1)));
    expect(text(a.sync.viewOf(key))).toBe(text(b.sync.viewOf(key)));
    expect(a.sync.viewOf(key)?.has(`members/${joiner.did}`)).toBe(true);
    expect(a.sync.viewOf(key)?.has(`members/${creator.did}`)).toBe(true);

    const pulled = await a.client.pull(key, "", 500);
    if (!pulled.ok) throw new Error(pulled.failure.reason);
    // founder, invitation, join, second invitation: four events, none twice.
    expect(pulled.value.events).toHaveLength(4);
    expect(a.sync.markOf(key, await eventIdOf(founder, webCryptoSha512))).toBe("confirmed");
    expect(a.sync.markOf(key, queued.id)).toBe("confirmed");
  });
});
