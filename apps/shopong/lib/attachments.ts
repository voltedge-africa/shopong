// The phone's files for a community (story 3.7). A photo or price list is checked and its metadata removed here, its
// SHA-512 taken, its bytes kept on this phone, and the bytes sent to the Node FIRST. Only when the Node has kept them is
// the `file.attached` event put in the offline queue (`sync.enqueue`), so the record never names a file the Node does
// not hold. Offline, the bytes wait on the phone and nothing is queued; `retryPending` sends them later.
//
// The record carries a generated label (`Price list 1a2b3c4d`), never the person's file name: a file name can hold an
// address. The person's own name is kept on this phone, for display only.
//
// A file the Node holds is checked when it is opened: its bytes (from the cache, or fetched) are hashed and compared with
// the event's SHA-512 (`verifyAttachment`). Only a match is cached, per community, least recently used first, under a
// size cap. A Node reply with no bytes is the Node failing, not a mismatch.
//
// The phone keeps no secret here: the Node client carries the phone's identity signer only.

import {
  assertNoPersonalData,
  checkFileBytes,
  createEvent,
  fromBase64,
  InvalidEventError,
  PersonalDataError,
  PERSONAL_DATA_MESSAGE,
  recordNameOf,
  verifyAttachment,
  type AttachmentPurpose,
  type EventEnvelope,
  type Sha512,
} from "@shopong/events";
import type { Did, JsonValue } from "@shopong/ports";
import { cacheNameOf, type ByteStore } from "./byteStore";
import type { NodeClient } from "./nodeClient";
import type { SyncService } from "./sync";

export type AttachPurpose = AttachmentPurpose;
export type FileState = "sending" | "saved" | "waiting" | "refused";
export type Check = "verified" | "does_not_match" | "cannot_check" | "unavailable";

/** The default cap on the phone's cached copies, in bytes (100 MB). */
export const CACHE_CAP_BYTES = 100 * 1024 * 1024;

/** One file as the order screen shows it. `saved` files may come from the record. */
export interface FileRow {
  readonly hash: string;
  readonly community: string;
  readonly order: string;
  readonly purpose: AttachmentPurpose;
  /** The name this phone shows (the person's own name for a file it sent; the record's label otherwise). */
  readonly name: string;
  readonly type: string;
  readonly size: number;
  readonly supplier?: string;
  readonly state: FileState;
  /** The plain reason the Node gave, when `state` is `refused`. */
  readonly reason?: string;
}

export interface PickedFile {
  /** The person's own file name. Shown on this phone; never sent to the Node or written to the record. */
  readonly name: string;
  readonly bytes: Uint8Array;
  /** Removes the picker's own copy of the file. Called once the Node has the bytes. */
  readonly discard?: () => Promise<void>;
}

export type AttachResult =
  | { readonly ok: true; readonly hash: string }
  | { readonly ok: false; readonly reason: string };

/** A file this phone is still sending, or has not yet sent. Keyed by community, order and hash. */
interface Pending {
  readonly community: string;
  readonly order: string;
  readonly purpose: AttachmentPurpose;
  readonly supplier?: string;
  readonly displayName: string;
  readonly type: string;
  readonly size: number;
  readonly hash: string;
  readonly event: EventEnvelope;
}

export interface AttachmentDeps {
  /** `undefined` when the build sets no Node: nothing is sent, and the bytes wait on the phone. */
  readonly node: NodeClient | undefined;
  readonly sync: SyncService;
  readonly pending: ByteStore;
  readonly cache: ByteStore;
  readonly did: Did;
  readonly sha512: Sha512;
  /** The record's view of a community, as this phone holds it after a pull. */
  readonly viewOf: (community: string) => ReadonlyMap<string, JsonValue> | undefined;
  readonly now?: () => number;
  readonly randomBytes?: (n: number) => Uint8Array;
  /** The cache's size cap in bytes. Default 100 MB. */
  readonly cacheCapBytes?: number;
}

export interface AttachmentService {
  /** Reads the index of files still to send. Call it before anything else. */
  start(): Promise<void>;
  /** Checks, strips, hashes and keeps a file, sends its bytes to the Node, then queues its event. */
  attach(
    community: string,
    order: string,
    purpose: AttachmentPurpose,
    file: PickedFile,
    supplier?: string,
  ): Promise<AttachResult>;
  /** Sends every file still waiting. Safe to call often. */
  retryPending(): Promise<void>;
  /** The rows for one order: this phone's files still waiting, sending or refused, then the files the record holds. */
  filesFor(community: string, order: string): FileRow[];
  /** Verifies a file's bytes against its recorded hash: from this community's cache, or fetched from the Node. */
  check(community: string, hash: string): Promise<Check>;
  /** Drops this community's cached copies, for example when the phone leaves the community. */
  forgetCommunity(community: string): Promise<void>;
}

const FILE_KEY = (order: string) =>
  `files-of/${encodeURIComponent(order.trim().replace(/\s+/g, " "))}/`;
const tidyOrder = (order: string) => order.trim().replace(/\s+/g, " ");

/** The name this phone shows for a file the person picked: the last part of its path, tidied. Never sent anywhere. */
export function labelOf(name: string, purpose: AttachmentPurpose): string {
  const last = name.split(/[\\/]/).pop() ?? "";
  const tidy = last
    .split("")
    .filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127)
    .join("")
    .replace(/\.\.+/g, ".")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 120)
    .trim();
  if (tidy !== "") return tidy;
  return purpose === "price-list" ? "Price list" : "Photo";
}

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const keyOf = (community: string, order: string, hash: string) => `${community}\n${order}\n${hash}`;

export function createAttachmentService(deps: AttachmentDeps): AttachmentService {
  const now = deps.now ?? Date.now;
  const random = deps.randomBytes ?? ((n: number) => crypto.getRandomValues(new Uint8Array(n)));
  const capBytes = deps.cacheCapBytes ?? CACHE_CAP_BYTES;
  let pendings: Pending[] = [];
  const states = new Map<string, { state: FileState; reason?: string }>();
  /** Files this phone finished with this session (saved, or refused): listed until the record shows them. */
  const recent = new Map<string, FileRow>();
  /** The cache's index for this session: name to size and last use. Least recently used goes first. */
  const cacheIndex = new Map<string, { size: number; last: number }>();
  let tick = 0;
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const next = chain.then(task, task);
    chain = next.catch(() => undefined);
    return next;
  };

  async function saveIndex(): Promise<void> {
    await deps.pending.write(
      "index.json",
      new TextEncoder().encode(JSON.stringify({ v: 2, items: pendings })),
    );
  }

  async function loadIndex(): Promise<void> {
    const bytes = await deps.pending.read("index.json");
    if (bytes === undefined) return;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
        v?: unknown;
        items?: unknown;
      };
      pendings = Array.isArray(parsed.items) ? (parsed.items as Pending[]) : [];
    } catch {
      pendings = [];
    }
  }

  /** Writes one cached copy and evicts the least recently used copies while the total is over the cap. */
  async function cachePut(community: string, hash: string, bytes: Uint8Array): Promise<void> {
    const name = cacheNameOf(community, hash);
    if (!(await deps.cache.write(name, bytes))) return;
    cacheIndex.set(name, { size: bytes.length, last: ++tick });
    let total = [...cacheIndex.values()].reduce((sum, entry) => sum + entry.size, 0);
    while (total > capBytes) {
      let oldest: string | undefined;
      for (const [candidate, entry] of cacheIndex) {
        if (oldest === undefined || entry.last < cacheIndex.get(oldest)!.last) oldest = candidate;
      }
      if (oldest === undefined || oldest === name) break;
      total -= cacheIndex.get(oldest)!.size;
      cacheIndex.delete(oldest);
      await deps.cache.remove(oldest);
    }
  }

  async function cacheRead(community: string, hash: string): Promise<Uint8Array | undefined> {
    const name = cacheNameOf(community, hash);
    const bytes = await deps.cache.read(name);
    if (bytes !== undefined) {
      const entry = cacheIndex.get(name);
      if (entry !== undefined) entry.last = ++tick;
    }
    return bytes;
  }

  /** Sends one file's bytes, then its event. Its bytes and index entry go only when the Node has kept them. */
  async function sendOne(entry: Pending): Promise<void> {
    const key = keyOf(entry.community, entry.order, entry.hash);
    if (deps.node === undefined) {
      states.set(key, { state: "waiting" });
      return;
    }
    const bytes = await deps.pending.read(entry.hash);
    if (bytes === undefined) {
      pendings = pendings.filter((p) => keyOf(p.community, p.order, p.hash) !== key);
      await saveIndex();
      states.set(key, {
        state: "refused",
        reason: "This file is no longer on this phone. Attach it again.",
      });
      return;
    }
    states.set(key, { state: "sending" });
    const reply = await deps.node.uploadFile(entry.community, {
      sha512: entry.hash,
      purpose: entry.purpose,
      type: entry.type,
      bytes,
    });
    const drop = async () => {
      pendings = pendings.filter((p) => keyOf(p.community, p.order, p.hash) !== key);
      // The bytes are shared by every order that attached this photo: removed only when no other entry still needs them.
      if (!pendings.some((p) => p.hash === entry.hash)) await deps.pending.remove(entry.hash);
      await saveIndex();
    };
    if (!reply.ok) {
      if (reply.failure.kind === "refused") {
        await drop();
        states.set(key, { state: "refused", reason: reply.failure.reason });
        recent.set(key, rowOf(entry, "refused", reply.failure.reason));
        return;
      }
      states.set(key, { state: "waiting" });
      return;
    }
    // The Node has the bytes. Only now does the record's reference go into the queue.
    await cachePut(entry.community, entry.hash, bytes);
    const queued = await deps.sync.enqueue(entry.community, entry.event);
    if (!queued.ok) {
      states.set(key, { state: "waiting" });
      return;
    }
    await drop();
    states.set(key, { state: "saved" });
    recent.set(key, rowOf(entry, "saved"));
    void deps.sync.flush();
  }

  function rowOf(entry: Pending, state: FileState, reason?: string): FileRow {
    return {
      hash: entry.hash,
      community: entry.community,
      order: entry.order,
      purpose: entry.purpose,
      name: entry.displayName,
      type: entry.type,
      size: entry.size,
      ...(entry.supplier === undefined ? {} : { supplier: entry.supplier }),
      state,
      ...(reason === undefined ? {} : { reason }),
    };
  }

  return {
    start: () =>
      serial(async () => {
        await loadIndex();
      }),

    attach: (community, order, purpose, file, supplier) =>
      serial(async (): Promise<AttachResult> => {
        const checked = checkFileBytes(file.bytes, purpose);
        if (!checked.ok) return { ok: false, reason: checked.message };
        const hash = toHex(await deps.sha512(checked.stored));
        const wanted = tidyOrder(order);
        const payload = {
          hash,
          size: checked.stored.length,
          type: checked.type,
          // The record's name is generated from the purpose and the hash: the person's file name never goes in.
          name: recordNameOf(purpose, hash),
          purpose,
          order: wanted,
          ...(purpose === "price-list"
            ? { supplier: (supplier ?? "").trim().replace(/\s+/g, " ") }
            : {}),
        };
        try {
          assertNoPersonalData(payload);
        } catch (error) {
          if (error instanceof PersonalDataError)
            return { ok: false, reason: PERSONAL_DATA_MESSAGE };
          throw error;
        }
        let event: EventEnvelope;
        try {
          event = createEvent({
            type: "file.attached",
            space: community,
            actor: deps.did,
            proof: [],
            claimedAt: now(),
            nonce: toHex(random(16)),
            payload,
          } as never) as EventEnvelope;
        } catch (error) {
          if (error instanceof InvalidEventError) {
            return {
              ok: false,
              reason: "This file's details can't be recorded. Check the order and the supplier.",
            };
          }
          throw error;
        }
        await deps.pending.write(hash, checked.stored);
        const entry: Pending = {
          community,
          order: wanted,
          purpose,
          ...(purpose === "price-list" ? { supplier: payload.supplier } : {}),
          displayName: labelOf(file.name, purpose),
          type: checked.type,
          size: checked.stored.length,
          hash,
          event,
        };
        pendings = [
          ...pendings.filter(
            (p) => keyOf(p.community, p.order, p.hash) !== keyOf(community, wanted, hash),
          ),
          entry,
        ];
        await saveIndex();
        await sendOne(entry);
        if (
          states.get(keyOf(community, wanted, hash))?.state === "saved" &&
          file.discard !== undefined
        ) {
          await file.discard();
        }
        return { ok: true, hash };
      }),

    retryPending: () =>
      serial(async () => {
        for (const entry of pendings) await sendOne(entry);
      }),

    filesFor(community, order) {
      const rows: FileRow[] = [];
      const wanted = tidyOrder(order);
      for (const p of pendings) {
        if (p.community !== community || p.order !== wanted) continue;
        const current = states.get(keyOf(community, p.order, p.hash));
        rows.push({
          ...rowOf(p, current?.state ?? "waiting"),
          ...(current?.reason === undefined ? {} : { reason: current.reason }),
        });
      }
      for (const row of recent.values()) {
        if (row.community !== community || row.order !== wanted) continue;
        if (rows.some((r) => r.hash === row.hash)) continue;
        rows.push(row);
      }
      const view = deps.viewOf(community);
      if (view !== undefined) {
        const prefix = FILE_KEY(wanted);
        for (const [key, value] of view) {
          if (!key.startsWith(prefix) || typeof value !== "object" || value === null) continue;
          const f = value as Record<string, unknown>;
          // The record shows it now, so this session's own row for it is no longer needed.
          recent.delete(keyOf(community, wanted, String(f.hash)));
          if (rows.some((r) => r.hash === f.hash)) continue;
          rows.push({
            hash: String(f.hash),
            community,
            order: wanted,
            purpose: f.purpose as AttachmentPurpose,
            name: String(f.name),
            type: String(f.type),
            size: Number(f.size),
            ...(typeof f.supplier === "string" ? { supplier: f.supplier } : {}),
            state: "saved",
          });
        }
      }
      return rows;
    },

    async check(community, hash) {
      const cached = await cacheRead(community, hash);
      if (cached !== undefined) {
        if ((await verifyAttachment(cached, hash, deps.sha512)).status === "verified")
          return "verified";
        await deps.cache.remove(cacheNameOf(community, hash));
        cacheIndex.delete(cacheNameOf(community, hash));
        return "does_not_match";
      }
      if (deps.node === undefined) return "unavailable";
      const got = await deps.node.readFile(community, hash);
      // A reply with no bytes is the Node failing to answer properly, not a file that differs.
      if (!got.ok || typeof got.value.bytes !== "string" || got.value.bytes === "")
        return "unavailable";
      const bytes = fromBase64(got.value.bytes);
      if (bytes === undefined) return "does_not_match";
      const verdict = await verifyAttachment(bytes, hash, deps.sha512);
      if (verdict.status !== "verified")
        return verdict.status === "cannot_check" ? "cannot_check" : "does_not_match";
      await cachePut(community, hash, bytes);
      return "verified";
    },

    async forgetCommunity(community) {
      for (const name of cacheIndex.keys()) {
        if (!name.startsWith(`${community}-`)) continue;
        cacheIndex.delete(name);
        await deps.cache.remove(name);
      }
    },
  };
}
