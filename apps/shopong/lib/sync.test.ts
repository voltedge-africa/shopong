// The phone's sync against a fake Node that keeps the same contract as the real one (story 3.4): an append is
// acknowledged once stored, a repeat is a duplicate, a pull returns entries after a cursor. The real Node is driven
// over HTTP in `apps/node/src/phone-sync.test.ts`. Rows of the plan's I/O matrix are named in each test.
import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import { checkInvitation, issueInvitation, type CheckedInvitation } from "@shopong/community";
import {
  eventIdOf,
  PERSONAL_DATA_MESSAGE,
  webCryptoSha512,
  type EventEnvelope,
} from "@shopong/events";
import type { Did } from "@shopong/ports";
import { describe, expect, it } from "vite-plus/test";
import { founderEvent, inviteEvent, joinEvent } from "./communityEvents";
import type { NodeClient, NodeFailure, NodeReply, PulledPage } from "./nodeClient";
import { createFileQueue, memoryQueue, type FileIo, type OfflineQueue } from "./offlineQueue";
import {
  backoffMs,
  BACKOFF_CAP_MS,
  createSyncService,
  MAX_BEHIND_RETRIES,
  type CommunityRef,
  type SyncService,
} from "./sync";

const T0 = 1_793_000_000_000;
const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const KEY = Array.from(randomBytes(32), (b) => b.toString(16).padStart(2, "0")).join("");

/** A fake of the real Node's record: a journal, admission, a lost reply, and an offline switch. */
function fakeNode(admitted: Did[]) {
  const journal: { id: string; writer: Did; event: EventEnvelope }[] = [];
  const sent: { id: string; event: string }[] = [];
  const pulls: { after: string }[] = [];
  const state = {
    down: false,
    loseNextReply: false,
    behindPulls: 0,
    refuse: undefined as string | undefined,
    clockSkew: false,
    notWritable: new Set<Did>(),
    admitted: new Set<Did>(admitted),
  };
  const client: NodeClient = {
    createCommunity: async () => ({
      ok: true,
      value: { key: KEY, spaceKey: "s", duplicate: false },
    }),
    admitMember: async () => ({ ok: true, value: { admitted: true } }),
    // The pool is read by the card, not by the queue (story 4.6): not part of these sync tests.
    pool: async () => ({ ok: false, failure: { kind: "offline", reason: "not used here" } }),
    planRoute: async () => ({ ok: false, failure: { kind: "offline", reason: "not used here" } }),
    route: async () => ({ ok: false, failure: { kind: "offline", reason: "not used here" } }),
    // Pledge payments are not exercised by the sync tests.
    payPledge: async () => offline(),
    paymentStatus: async () => offline(),
    async postEvent(_key, event) {
      if (state.down) return offline();
      const id = await eventIdOf(event, webCryptoSha512);
      sent.push({ id, event: JSON.stringify(event) });
      if (state.clockSkew) return clock();
      if (state.refuse !== undefined) return refused(state.refuse);
      if (!state.admitted.has(event.actor as Did))
        return refused("Only a member of the community can read it.", "not_member");
      if (state.notWritable.has(event.actor as Did)) return waiting();
      const existing = journal.find((entry) => entry.id === id);
      if (existing === undefined) journal.push({ id, writer: event.actor as Did, event });
      if (state.loseNextReply) {
        state.loseNextReply = false;
        return offline();
      }
      return { ok: true, value: { id, duplicate: existing !== undefined } };
    },
    async pull(_key, after) {
      if (state.down) return offline();
      pulls.push({ after });
      const start = after === "" ? 0 : Number(after);
      const page = journal.slice(start, start + 100);
      const behind = state.behindPulls > 0;
      if (behind) state.behindPulls -= 1;
      const value: PulledPage = {
        events: page.map((entry) => ({ id: entry.id, writer: entry.writer, event: entry.event })),
        next: String(start + page.length),
        more: start + page.length < journal.length,
        behind,
      };
      return { ok: true, value };
    },
  };
  return { client, journal, sent, pulls, state };
}

function offline(): NodeReply<never> {
  return { ok: false, failure: { kind: "offline", reason: "No answer from the OCN Node." } };
}
function waiting(): NodeReply<never> {
  return {
    ok: false,
    failure: {
      kind: "waiting",
      status: 403,
      problem: "not_writable",
      reason: "This person cannot write to that community.",
    },
  };
}
function clock(): NodeReply<never> {
  return {
    ok: false,
    failure: {
      kind: "clock",
      status: 401,
      problem: "clock_skew",
      reason: "That request's time is too far from the Node's clock.",
    },
  };
}
function refused(reason: string, problem = "refused"): NodeReply<never> {
  return { ok: false, failure: { kind: "refused", status: 403, problem, reason } as NodeFailure };
}

async function person() {
  const auth = new IsoUcanCapabilityAuth();
  return { auth, did: await auth.createIdentity() };
}

function serviceFor(options: {
  node: NodeClient | undefined;
  queue?: OfflineQueue;
  auth: IsoUcanCapabilityAuth;
  now?: () => number;
}): SyncService {
  return createSyncService({
    node: options.node,
    queue: options.queue ?? memoryQueue(),
    auth: options.auth,
    now: options.now ?? (() => T0),
  });
}

/** Two plain values: the view as a sorted list, so two views compare equal when they hold the same entries. */
const viewText = (view: ReadonlyMap<string, unknown> | undefined) =>
  JSON.stringify([...(view ?? new Map()).entries()].sort(([a], [b]) => (a < b ? -1 : 1)));

describe("offline writes that converge (story 3.4 sync)", () => {
  it("I/O row: offline write is queued and shows 'on your phone', and nothing is lost when the Node is down", async () => {
    const creator = await person();
    const fake = fakeNode([creator.did]);
    fake.state.down = true;
    const sync = serviceFor({ node: fake.client, auth: creator.auth });
    await sync.start();
    const event = founderEvent({ community: KEY, me: creator.did, now: T0, randomBytes });
    const queued = await sync.enqueue(KEY, event);
    if (!queued.ok) throw new Error(queued.reason);
    expect(sync.markOf(KEY, queued.id)).toBe("on_phone");
    const state = await sync.flush();
    expect(state.result).toBe("offline");
    expect(state.pending).toBe(1);
    expect(fake.journal).toHaveLength(0);
  });

  it("I/O row: reconnect sends queued events in order, each once, and removes each when acknowledged", async () => {
    const creator = await person();
    const fake = fakeNode([creator.did]);
    const queue = memoryQueue();
    const sync = serviceFor({ node: fake.client, queue, auth: creator.auth });
    const ids: string[] = [];
    for (const at of [T0, T0 + 1, T0 + 2]) {
      const queued = await sync.enqueue(
        KEY,
        founderEvent({ community: KEY, me: creator.did, now: at, randomBytes }),
      );
      if (!queued.ok) throw new Error(queued.reason);
      ids.push(queued.id);
    }
    const state = await sync.flush();
    expect(state).toMatchObject({ result: "connected", pending: 0 });
    expect(fake.journal.map((entry) => entry.id)).toEqual(ids);
    expect(await queue.read()).toEqual({ ok: true, items: [] });
    for (const id of ids) expect(sync.markOf(KEY, id)).toBe("saved");
  });

  it("I/O row: a retry after a lost reply is a duplicate the Node recognises; the same id and bytes are sent again", async () => {
    const creator = await person();
    const fake = fakeNode([creator.did]);
    const sync = serviceFor({ node: fake.client, auth: creator.auth });
    const queued = await sync.enqueue(
      KEY,
      founderEvent({ community: KEY, me: creator.did, now: T0, randomBytes }),
    );
    if (!queued.ok) throw new Error(queued.reason);
    fake.state.loseNextReply = true;
    expect((await sync.flush()).result).toBe("offline");
    expect(fake.journal).toHaveLength(1);
    expect((await sync.flush()).result).toBe("connected");
    expect(fake.journal).toHaveLength(1);
    const sentIds = fake.sent.map((s) => s.id);
    expect(sentIds).toEqual([queued.id, queued.id]);
    expect(fake.sent[0]!.event).toBe(fake.sent[1]!.event);
  });

  it("I/O row: two phones write offline, reconverge after both sync, and show the same view", async () => {
    const creator = await person();
    const joiner = await person();
    const fake = fakeNode([creator.did, joiner.did]);
    const invited = await issueInvitation({
      auth: creator.auth,
      creator: creator.did,
      spaceKey: KEY,
      invitee: joiner.did,
      now: T0,
    });
    if (!invited.ok) throw new Error(invited.error.message);
    const ref: CommunityRef = { key: KEY, creator: creator.did };

    // Both phones write while the Node is out of reach: the founding, the invitation on the creator's phone.
    const phoneA = serviceFor({ node: fake.client, auth: creator.auth });
    const phoneB = serviceFor({ node: fake.client, auth: joiner.auth });
    fake.state.down = true;
    await phoneA.enqueue(
      KEY,
      founderEvent({ community: KEY, me: creator.did, now: T0, randomBytes }),
    );
    await phoneA.enqueue(
      KEY,
      inviteEvent({
        community: KEY,
        me: creator.did,
        now: T0 + 1,
        randomBytes,
        invitation: invited.value,
      }),
    );
    const checked = await checkInvitation({
      auth: joiner.auth,
      text: invited.value.link,
      me: joiner.did,
      now: T0 + 2,
    });
    if (!checked.ok) throw new Error(checked.error.message);
    await phoneB.enqueue(
      KEY,
      joinEvent({
        community: KEY,
        me: joiner.did,
        now: T0 + 2,
        randomBytes,
        checked: checked.value as CheckedInvitation,
      }),
    );
    fake.state.down = false;

    await phoneA.flush();
    await phoneB.flush();
    await phoneA.pull(ref);
    await phoneB.pull(ref);
    expect(viewText(phoneA.viewOf(KEY))).toBe(viewText(phoneB.viewOf(KEY)));
    expect(phoneA.viewOf(KEY)?.has(`members/${joiner.did}`)).toBe(true);
    expect(phoneA.viewOf(KEY)?.has(`members/${creator.did}`)).toBe(true);
  });

  it("cursor row: the phone stores `next` and sends it back as `after`; a `behind` answer pulls again, a few times", async () => {
    const creator = await person();
    const fake = fakeNode([creator.did]);
    const sync = serviceFor({ node: fake.client, auth: creator.auth });
    const ref: CommunityRef = { key: KEY, creator: creator.did };
    await sync.enqueue(
      KEY,
      founderEvent({ community: KEY, me: creator.did, now: T0, randomBytes }),
    );
    await sync.flush();
    await sync.pull(ref);
    await sync.pull(ref);
    expect(fake.pulls.map((p) => p.after)).toEqual(["", "1"]);

    fake.state.behindPulls = 1;
    fake.pulls.length = 0;
    await sync.pull(ref);
    expect(fake.pulls.length).toBe(2);
    fake.state.behindPulls = 99;
    fake.pulls.length = 0;
    await sync.pull(ref);
    expect(fake.pulls.length).toBe(MAX_BEHIND_RETRIES + 1);
  });

  it("confirmed row: an event returned by a pull is 'Confirmed', and the 'on your phone' mark goes", async () => {
    const creator = await person();
    const fake = fakeNode([creator.did]);
    const sync = serviceFor({ node: fake.client, auth: creator.auth });
    const queued = await sync.enqueue(
      KEY,
      founderEvent({ community: KEY, me: creator.did, now: T0, randomBytes }),
    );
    if (!queued.ok) throw new Error(queued.reason);
    await sync.flush();
    expect(sync.markOf(KEY, queued.id)).toBe("saved");
    await sync.pull({ key: KEY, creator: creator.did });
    expect(sync.markOf(KEY, queued.id)).toBe("confirmed");
  });

  it("not-a-member row: a refused event stays at the head, is shown with the Node's plain reason, and blocks nothing silently", async () => {
    const creator = await person();
    const stranger = await person();
    const fake = fakeNode([creator.did]);
    const sync = serviceFor({ node: fake.client, auth: stranger.auth });
    const first = await sync.enqueue(
      KEY,
      founderEvent({ community: KEY, me: stranger.did, now: T0, randomBytes }),
    );
    if (!first.ok) throw new Error(first.reason);
    const state = await sync.flush();
    expect(state.result).toBe("refused");
    expect(state.refusal).toBe("Only a member of the community can read it.");
    expect(state.pending).toBe(1);
    expect(fake.journal).toHaveLength(0);
    // The person may remove the parked item; the queue is then empty.
    expect((await sync.discardParked()).pending).toBe(0);
  });

  it("node-down row: retries back off in order and stop at the cap", async () => {
    const creator = await person();
    const fake = fakeNode([creator.did]);
    fake.state.down = true;
    const sync = serviceFor({ node: fake.client, auth: creator.auth });
    await sync.enqueue(
      KEY,
      founderEvent({ community: KEY, me: creator.did, now: T0, randomBytes }),
    );
    const waits: number[] = [];
    for (let i = 0; i < 8; i++) waits.push((await sync.flush()).retryInMs ?? -1);
    expect(waits).toEqual([2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000]);
  });

  it("backoff is ordered, capped, and never overflows", () => {
    let last = 0;
    for (let n = 1; n <= 40; n++) {
      const wait = backoffMs(n);
      expect(wait).toBeGreaterThanOrEqual(last);
      expect(wait).toBeLessThanOrEqual(BACKOFF_CAP_MS);
      last = wait;
    }
    expect(backoffMs(1)).toBe(2_000);
  });

  it("unreadable-queue row (review P6): the bad file is set aside, a fresh queue starts, and the person is told", async () => {
    const creator = await person();
    const fake = fakeNode([creator.did]);
    let text: string | null = "{ this is not a queue";
    let aside: string | null = null;
    const io: FileIo = {
      read: async () => text,
      write: async (next) => void (text = next),
      setAside: async () => {
        aside = text;
        text = null;
      },
    };
    const sync = serviceFor({ node: fake.client, queue: createFileQueue(io), auth: creator.auth });
    expect((await sync.start()).setAside).toBe(true);
    expect(aside).toBe("{ this is not a queue");
    const queued = await sync.enqueue(
      KEY,
      founderEvent({ community: KEY, me: creator.did, now: T0, randomBytes }),
    );
    expect(queued.ok).toBe(true);
    expect((await sync.flush()).result).toBe("connected");
    expect(fake.journal).toHaveLength(1);
  });

  it("write-failure row (review P3): a change the queue cannot store is reported, not claimed as on the phone", async () => {
    const creator = await person();
    const fake = fakeNode([creator.did]);
    const queue: OfflineQueue = {
      ...memoryQueue(),
      add: async () => ({ ok: false, problem: "write_failed" }),
    };
    const sync = serviceFor({ node: fake.client, queue, auth: creator.auth });
    const result = await sync.enqueue(
      KEY,
      founderEvent({ community: KEY, me: creator.did, now: T0, randomBytes }),
    );
    expect(result.ok).toBe(false);
  });

  it("review P2: a refused item is parked: not sent again on flush or pull until Try again or Remove", async () => {
    const creator = await person();
    const fake = fakeNode([creator.did]);
    fake.state.refuse = "Only a member of the community can read it.";
    const sync = serviceFor({ node: fake.client, auth: creator.auth });
    await sync.enqueue(
      KEY,
      founderEvent({ community: KEY, me: creator.did, now: T0, randomBytes }),
    );
    expect((await sync.flush()).result).toBe("refused");
    expect(fake.sent).toHaveLength(1);
    expect((await sync.flush()).result).toBe("refused");
    expect((await sync.pull({ key: KEY, creator: creator.did })).result).toBe("refused");
    expect(fake.sent).toHaveLength(1);
    expect(fake.pulls).toHaveLength(0);
    // Try again sends it once more; the Node refuses it again and it stays parked.
    expect((await sync.flush(true)).result).toBe("refused");
    expect(fake.sent).toHaveLength(2);
    // Remove this change takes it off the phone, and the queue can go on.
    expect((await sync.discardParked()).pending).toBe(0);
    fake.state.refuse = undefined;
    fake.state.admitted.add(creator.did);
    expect((await sync.flush()).result).toBe("connected");
  });

  it("review P7: a clock refusal is not parked: it is retried with backoff and the person is told to check the clock", async () => {
    const creator = await person();
    const fake = fakeNode([creator.did]);
    fake.state.clockSkew = true;
    const sync = serviceFor({ node: fake.client, auth: creator.auth });
    await sync.enqueue(
      KEY,
      founderEvent({ community: KEY, me: creator.did, now: T0, randomBytes }),
    );
    const first = await sync.flush();
    expect(first).toMatchObject({ result: "clock_skew", pending: 1, retryInMs: 2_000 });
    expect(first.refusal).toBeUndefined();
    fake.state.clockSkew = false;
    expect((await sync.flush()).result).toBe("connected");
    expect(fake.journal).toHaveLength(1);
  });

  it("review P8: a pull that succeeds does not reset the send failure count", async () => {
    const creator = await person();
    const fake = fakeNode([creator.did]);
    const sync = serviceFor({ node: fake.client, auth: creator.auth });
    const ref: CommunityRef = { key: KEY, creator: creator.did };
    await sync.enqueue(
      KEY,
      founderEvent({ community: KEY, me: creator.did, now: T0, randomBytes }),
    );
    fake.state.down = true;
    expect((await sync.flush()).retryInMs).toBe(2_000);
    expect((await sync.flush()).retryInMs).toBe(4_000);
    expect((await sync.flush()).retryInMs).toBe(8_000);
    fake.state.down = false;
    await sync.pull(ref);
    fake.state.down = true;
    expect((await sync.flush()).retryInMs).toBe(16_000);
  });

  it("review P4: a hostile Node's entries are ignored and counted: wrong id, wrong community, wrong writer", async () => {
    const creator = await person();
    const stranger = await person();
    const fake = fakeNode([creator.did, stranger.did]);
    const sync = serviceFor({ node: fake.client, auth: creator.auth });
    const ref: CommunityRef = { key: KEY, creator: creator.did };
    const mine = founderEvent({ community: KEY, me: creator.did, now: T0, randomBytes });
    await sync.enqueue(KEY, mine);
    await sync.flush();
    const other = "c".repeat(64);
    // (a) an id that is not the event's SHA-512
    fake.journal.push({
      id: "f".repeat(128),
      writer: creator.did,
      event: founderEvent({ community: KEY, me: creator.did, now: T0 + 5, randomBytes }),
    });
    // (b) an event for another community, returned here
    const elsewhere = founderEvent({ community: other, me: creator.did, now: T0 + 6, randomBytes });
    fake.journal.push({
      id: await eventIdOf(elsewhere, webCryptoSha512),
      writer: creator.did,
      event: elsewhere,
    });
    // (c) a writer that is not the event's actor
    const forged = founderEvent({ community: KEY, me: stranger.did, now: T0 + 7, randomBytes });
    fake.journal.push({
      id: await eventIdOf(forged, webCryptoSha512),
      writer: creator.did,
      event: forged,
    });

    const state = await sync.pull(ref);
    expect(state.ignored).toBe(3);
    expect(sync.viewOf(KEY)?.has(`members/${stranger.did}`)).toBe(false);
    // The phone's own event, returned by the right community, is confirmed. Another community never is.
    expect(sync.markOf(KEY, await eventIdOf(mine, webCryptoSha512))).toBe("confirmed");
    expect(sync.markOf(other, await eventIdOf(mine, webCryptoSha512))).toBeUndefined();
  });

  it("review P4: an event another member wrote is shown but is never marked confirmed for this phone", async () => {
    const creator = await person();
    const joiner = await person();
    const fake = fakeNode([creator.did, joiner.did]);
    const sync = serviceFor({ node: fake.client, auth: creator.auth });
    const theirs = founderEvent({ community: KEY, me: joiner.did, now: T0, randomBytes });
    fake.journal.push({
      id: await eventIdOf(theirs, webCryptoSha512),
      writer: joiner.did,
      event: theirs,
    });
    const state = await sync.pull({ key: KEY, creator: creator.did });
    expect(state.ignored).toBe(0);
    expect(sync.markOf(KEY, await eventIdOf(theirs, webCryptoSha512))).toBeUndefined();
  });

  it("personal-data row: an event that carries a raw phone number is refused before it is queued", async () => {
    const creator = await person();
    const fake = fakeNode([creator.did]);
    const sync = serviceFor({ node: fake.client, auth: creator.auth });
    const base = founderEvent({ community: KEY, me: creator.did, now: T0, randomBytes });
    const leaking = {
      ...base,
      payload: { invitation: "founder", phone: "+27821234567" },
    } as unknown as EventEnvelope;
    const result = await sync.enqueue(KEY, leaking);
    expect(result).toEqual({ ok: false, reason: PERSONAL_DATA_MESSAGE });
    expect((await sync.flush()).pending).toBe(0);
    expect(fake.sent).toHaveLength(0);
  });

  it("apply row: the phone runs the same apply over what it pulled, and a bad join is shown as rejected in the view", async () => {
    const creator = await person();
    const stranger = await person();
    const fake = fakeNode([creator.did, stranger.did]);
    const sync = serviceFor({ node: fake.client, auth: creator.auth });
    const ref: CommunityRef = { key: KEY, creator: creator.did };
    await sync.enqueue(
      KEY,
      founderEvent({ community: KEY, me: creator.did, now: T0, randomBytes }),
    );
    // A `member.joined` with no invitation: apply must refuse it on every phone.
    const bogus = founderEvent({ community: KEY, me: stranger.did, now: T0, randomBytes });
    fake.journal.push({
      id: await eventIdOf(bogus, webCryptoSha512),
      writer: stranger.did,
      event: bogus,
    });
    await sync.flush();
    await sync.pull(ref);
    const rejected = [...(sync.viewOf(KEY) ?? new Map()).keys()].filter((k) =>
      k.startsWith("rejected/"),
    );
    expect(rejected).toHaveLength(1);
    expect(sync.viewOf(KEY)?.has(`members/${stranger.did}`)).toBe(false);
  });

  it("waiting row: a writer the Node has not admitted yet is kept and retried in order, then sent", async () => {
    const creator = await person();
    const joiner = await person();
    const fake = fakeNode([creator.did, joiner.did]);
    fake.state.notWritable.add(joiner.did);
    const sync = serviceFor({ node: fake.client, auth: joiner.auth });
    const queued = await sync.enqueue(
      KEY,
      founderEvent({ community: KEY, me: joiner.did, now: T0, randomBytes }),
    );
    if (!queued.ok) throw new Error(queued.reason);
    const first = await sync.flush();
    expect(first).toMatchObject({ result: "waiting", pending: 1, retryInMs: 2_000 });
    fake.state.notWritable.delete(joiner.did);
    expect((await sync.flush()).result).toBe("connected");
    expect(fake.journal.map((e) => e.id)).toEqual([queued.id]);
  });

  it("reads fresh each time: a second phone pulls the same journal and gets the same view", async () => {
    const creator = await person();
    const fake = fakeNode([creator.did]);
    const a = serviceFor({ node: fake.client, auth: creator.auth });
    await a.enqueue(KEY, founderEvent({ community: KEY, me: creator.did, now: T0, randomBytes }));
    await a.flush();
    const b = serviceFor({ node: fake.client, auth: creator.auth });
    await a.pull({ key: KEY, creator: creator.did });
    await b.pull({ key: KEY, creator: creator.did });
    expect(viewText(a.viewOf(KEY))).toBe(viewText(b.viewOf(KEY)));
  });

  it("no-node row: with no Node address nothing is sent and the queue is kept", async () => {
    const creator = await person();
    const queue = memoryQueue();
    const sync = serviceFor({ node: undefined, queue, auth: creator.auth });
    await sync.enqueue(
      KEY,
      founderEvent({ community: KEY, me: creator.did, now: T0, randomBytes }),
    );
    expect(await sync.flush()).toMatchObject({ result: "no_node", pending: 1 });
    expect(await queue.read()).toMatchObject({ ok: true });
  });
});
