// The phone's sync (story 3.4). It sends the offline queue to the Node in order, pulls each community's entries by
// cursor, and runs the same `apply` the Node runs over what it pulled, so every phone shows one view.
//
// Rules (the plan's matrix, and the review of 3.4):
//  - An event is sent with its id and bytes unchanged on every retry; the client signs each call afresh.
//  - An answer of 200 removes the item whatever `duplicate` says (a retry after a lost reply is harmless).
//  - An item is retried in order with capped backoff (`backoffMs`) while the Node is offline or not yet willing, and
//    after a clock refusal (review P7). The send and pull failure counts are kept apart (review P8).
//  - A refusal the Node gives in plain words parks the item: it is not sent again until the person taps Try again or
//    Remove this change, and pulls wait too (review P2).
//  - Every pulled entry is checked before use: its id must be the event's SHA-512, its event's `space` the community,
//    and its writer the event's actor. A bad entry is ignored and counted (review P4). Only events this phone sent
//    and that come back from the right community are marked "Confirmed". Marks are kept per community.
//  - Nothing is sent from a queue that was set aside (review P6).
//  - No secret is held here: the client carries the phone's identity signer only, and the queue carries envelopes.
//
// This module imports no native code, so the tests can drive it over real HTTP.

import { communityDefinition } from "@shopong/community";
import {
  assertNoPersonalData,
  eventIdOf,
  PERSONAL_DATA_MESSAGE,
  PersonalDataError,
  webCryptoSha512,
  type EventEnvelope,
  type Sha512,
} from "@shopong/events";
import type {
  ApplyHost,
  CapabilityAuth,
  Did,
  JsonValue,
  RecordEntry,
  ViewWriter,
} from "@shopong/ports";
import type { NodeClient } from "./nodeClient";
import type { OfflineQueue } from "./offlineQueue";

/** The first retry waits this long, each later one twice as long, up to the cap. */
export const BACKOFF_BASE_MS = 2_000;
export const BACKOFF_CAP_MS = 60_000;
/** Pages pulled in one go, and how many times a `behind` answer is pulled again before the pull stops. */
export const PULL_PAGE_LIMIT = 100;
export const MAX_PULL_PAGES = 50;
export const MAX_BEHIND_RETRIES = 3;

/** How long to wait before the `failures`-th retry (1 for the first). Never more than the cap. */
export function backoffMs(failures: number): number {
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1));
}

export type Mark = "on_phone" | "saved" | "confirmed";

export type SyncResult =
  | "none"
  | "connected"
  | "offline"
  | "waiting"
  | "clock_skew"
  | "refused"
  | "no_node";

export interface SyncState {
  readonly result: SyncResult;
  /** Items still on the phone, not yet acknowledged by the Node. */
  readonly pending: number;
  /** The plain reason the Node gave for the parked item, when `result` is `refused`. */
  readonly refusal?: string;
  readonly lastSyncAt?: number;
  /** When `offline`, `waiting` or `clock_skew`, how long until the next automatic try. */
  readonly retryInMs?: number;
  /** The stored queue could not be read and was set aside; a fresh queue started (review P6). */
  readonly setAside?: boolean;
  /** Entries from the last pull that failed a check and were ignored (review P4). */
  readonly ignored?: number;
}

export interface CommunityRef {
  readonly key: string;
  /** The creator's DID: `apply` needs it to check every invitation chain. */
  readonly creator: Did;
}

export interface SyncOptions {
  /** `undefined` when the build sets no Node: nothing is sent, and the queue is kept. */
  readonly node: NodeClient | undefined;
  readonly queue: OfflineQueue;
  /** Verifies invitation tokens during the in-memory `apply`. The phone's own signer. */
  readonly auth: CapabilityAuth;
  readonly now?: () => number;
  readonly sha512?: Sha512;
  readonly pageLimit?: number;
  /** Called after the state or a mark changes, so the screen can redraw. */
  readonly onChange?: () => void;
}

export type EnqueueResult =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly reason: string };

export interface SyncService {
  /** Reads the queue once. Call it before anything else. */
  start(): Promise<SyncState>;
  /** Writes an event to the queue for a community. Works offline. */
  enqueue(community: string, event: EventEnvelope): Promise<EnqueueResult>;
  /**
   * Sends the queue in order. Concurrent calls share one run. A parked item is not sent again unless `force` is set
   * (the person tapped Try again).
   */
  flush(force?: boolean): Promise<SyncState>;
  /** Pulls a community's entries after the stored cursor, checks them, then runs `apply` over them in memory. */
  pull(ref: CommunityRef, force?: boolean): Promise<SyncState>;
  /** Removes the parked item at the head of the queue, so the rest can go. */
  discardParked(): Promise<SyncState>;
  /** The mark of one of this phone's events in one community. */
  markOf(community: string, eventId: string): Mark | undefined;
  /** The view `apply` made from the checked entries of a community, or undefined before any pull. */
  viewOf(community: string): ReadonlyMap<string, JsonValue> | undefined;
  state(): SyncState;
}

const EMPTY: SyncState = { result: "none", pending: 0 };

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Ids per community, for marks. */
class IdsByCommunity {
  readonly #map = new Map<string, Set<string>>();
  add(community: string, id: string): void {
    let ids = this.#map.get(community);
    if (ids === undefined) {
      ids = new Set();
      this.#map.set(community, ids);
    }
    ids.add(id);
  }
  has(community: string, id: string): boolean {
    return this.#map.get(community)?.has(id) === true;
  }
  delete(community: string, id: string): void {
    this.#map.get(community)?.delete(id);
  }
}

export function createSyncService(options: SyncOptions): SyncService {
  const { node, queue, auth } = options;
  const now = options.now ?? Date.now;
  const sha512 = options.sha512 ?? webCryptoSha512;
  const pageLimit = options.pageLimit ?? PULL_PAGE_LIMIT;

  let current: SyncState = EMPTY;
  let sendFailures = 0;
  let pullFailures = 0;
  let parked = false;
  let inFlight: Promise<SyncState> | undefined;
  const queued = new IdsByCommunity();
  const sent = new IdsByCommunity();
  const saved = new IdsByCommunity();
  const confirmed = new IdsByCommunity();
  const cursors = new Map<string, string>();
  const entries = new Map<string, { list: RecordEntry<EventEnvelope>[]; seen: Set<string> }>();
  const views = new Map<string, ReadonlyMap<string, JsonValue>>();

  const set = (next: SyncState): SyncState => {
    current = next;
    options.onChange?.();
    return next;
  };

  /** `apply` run in memory over the checked entries, in the order the Node gave them. Same entries, same view. */
  async function viewFrom(ref: CommunityRef, list: RecordEntry<EventEnvelope>[]) {
    const definition = communityDefinition({ auth, sha512 }, ref.creator, ref.key);
    const view = new Map<string, JsonValue>();
    const writer: ViewWriter = {
      get: async (key) => (view.has(key) ? clone(view.get(key)!) : undefined),
      list: async (prefix) =>
        [...view.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, value]) => ({ key, value: clone(value) })),
      put: async (key, value) => {
        view.set(key, clone(value));
      },
      del: async (key) => {
        view.delete(key);
      },
    };
    const writers = new Set<Did>([ref.creator]);
    const host: ApplyHost = {
      addWriter: async (did) => {
        writers.add(did);
      },
      removeWriter: async (did) => {
        writers.delete(did);
      },
    };
    await definition.apply(
      list.map((entry) => ({ ...entry })),
      writer,
      host,
    );
    return view;
  }

  async function pendingCount(): Promise<number> {
    const read = await queue.read();
    return read.ok ? read.items.length : 0;
  }

  async function sendAll(): Promise<SyncState> {
    if (node === undefined) return set({ result: "no_node", pending: await pendingCount() });
    const read = await queue.read();
    if (!read.ok)
      return set({ result: "offline", pending: 0, retryInMs: backoffMs(++sendFailures) });
    let remaining = read.items.length;
    for (const item of read.items) {
      // The same item, with the same id and bytes, every time: a retry is a duplicate the Node recognises.
      const reply = await node.postEvent(item.community, item.event);
      if (reply.ok) {
        await queue.remove(item.id);
        queued.delete(item.community, item.id);
        saved.add(item.community, item.id);
        remaining -= 1;
        sendFailures = 0;
        continue;
      }
      const failure = reply.failure;
      if (failure.kind === "refused") {
        parked = true;
        return set({
          result: "refused",
          pending: remaining,
          refusal: failure.reason,
          lastSyncAt: now(),
        });
      }
      sendFailures += 1;
      const wait = backoffMs(sendFailures);
      if (failure.kind === "clock") {
        return set({ result: "clock_skew", pending: remaining, retryInMs: wait });
      }
      return set({
        result: failure.kind === "offline" ? "offline" : "waiting",
        pending: remaining,
        retryInMs: wait,
      });
    }
    sendFailures = 0;
    return set({ result: "connected", pending: 0, lastSyncAt: now() });
  }

  async function pullAll(ref: CommunityRef, force: boolean): Promise<SyncState> {
    if (node === undefined) return set({ result: "no_node", pending: await pendingCount() });
    // A refused item parks the pulls too, until the person tries again (review P2).
    if (parked && !force) return current;
    const store = entries.get(ref.key) ?? { list: [], seen: new Set<string>() };
    entries.set(ref.key, store);
    let after = cursors.get(ref.key) ?? "";
    let behindRetries = 0;
    let ignored = 0;
    for (let page = 0; page < MAX_PULL_PAGES; page++) {
      const reply = await node.pull(ref.key, after, pageLimit);
      if (!reply.ok) {
        const pending = await pendingCount();
        if (reply.failure.kind === "refused") {
          return set({
            result: "refused",
            pending,
            refusal: reply.failure.reason,
            lastSyncAt: now(),
          });
        }
        pullFailures += 1;
        return set({ ...current, pending, retryInMs: backoffMs(pullFailures) });
      }
      for (const item of reply.value.events) {
        // Review P4: the Node's word is checked before anything is used.
        const event = item.event;
        const honest =
          event.space === ref.key &&
          item.writer === event.actor &&
          (await eventIdOf(event, sha512)) === item.id;
        if (!honest) {
          ignored += 1;
          continue;
        }
        if (sent.has(ref.key, item.id)) confirmed.add(ref.key, item.id);
        if (store.seen.has(item.id)) continue;
        store.seen.add(item.id);
        store.list.push({
          id: item.id as RecordEntry<EventEnvelope>["id"],
          writer: item.writer,
          event,
        });
      }
      after = reply.value.next;
      cursors.set(ref.key, after);
      if (reply.value.behind) {
        // The Node had not yet caught up with this phone's own appends: pull again, a few times.
        behindRetries += 1;
        if (behindRetries > MAX_BEHIND_RETRIES) break;
        continue;
      }
      if (!reply.value.more) break;
    }
    pullFailures = 0;
    views.set(ref.key, await viewFrom(ref, store.list));
    const pending = await pendingCount();
    const result: SyncResult = current.result === "none" ? "connected" : current.result;
    return set({ ...current, result, pending, lastSyncAt: now(), ignored });
  }

  return {
    async start() {
      const read = await queue.read();
      if (!read.ok) return set({ result: "offline", pending: 0 });
      for (const item of read.items) queued.add(item.community, item.id);
      return set({
        ...current,
        pending: read.items.length,
        ...(read.setAside ? { setAside: true } : {}),
      });
    },
    async enqueue(community, event) {
      try {
        assertNoPersonalData(event.payload);
      } catch (error) {
        if (error instanceof PersonalDataError) return { ok: false, reason: PERSONAL_DATA_MESSAGE };
        throw error;
      }
      const id = await eventIdOf(event, sha512);
      const written = await queue.add({ id, community, event });
      if (!written.ok) {
        return { ok: false, reason: "It could not be saved on this phone." };
      }
      queued.add(community, id);
      sent.add(community, id);
      set({ ...current, pending: await pendingCount() });
      return { ok: true, id };
    },
    flush(force = false) {
      if (parked && !force) return Promise.resolve(current);
      if (force) parked = false;
      if (inFlight === undefined) {
        inFlight = sendAll().finally(() => {
          inFlight = undefined;
        });
      }
      return inFlight;
    },
    pull(ref, force = false) {
      return pullAll(ref, force);
    },
    async discardParked() {
      const read = await queue.read();
      parked = false;
      if (!read.ok || read.items.length === 0) return set({ ...current, pending: 0 });
      const head = read.items[0]!;
      await queue.remove(head.id);
      return set({ result: "none", pending: read.items.length - 1 });
    },
    markOf(community, eventId) {
      if (confirmed.has(community, eventId)) return "confirmed";
      if (saved.has(community, eventId)) return "saved";
      if (queued.has(community, eventId)) return "on_phone";
      return undefined;
    },
    viewOf(community) {
      return views.get(community);
    },
    state: () => current,
  };
}
