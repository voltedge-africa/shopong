// The phone's offline queue (story 3.4): the events this phone wrote and has not yet had acknowledged by the Node,
// in the order they were written. It holds envelopes only, which carry commitments and no PII (AGENTS rule 6), and
// never a secret. An item is keyed by its event id, so adding the same event twice keeps one copy.
//
// Two adapters share one contract (`offlineQueue.contract.ts`): memory (web, and tests) and a file (native, through
// an injected `FileIo`, see `queueStore.ts`). Every file operation runs one after another (review P1), so no change
// overwrites another. A stored file that cannot be read is moved aside and a fresh queue starts (review P6).

import type { EventEnvelope } from "@shopong/events";

export interface QueueItem {
  /** The event id: SHA-512 of the canonical JSON (AGENTS rule 5). The retry key. */
  readonly id: string;
  /** The community key the event belongs to (the envelope's `space`). */
  readonly community: string;
  readonly event: EventEnvelope;
}

/**
 * `setAside` is true when the stored file could not be read and was moved aside: the queue starts fresh and the
 * person is told. Nothing from the set-aside bytes is sent.
 */
export type QueueRead =
  | { readonly ok: true; readonly items: readonly QueueItem[]; readonly setAside?: boolean }
  | { readonly ok: false; readonly problem: "unreadable" };

export type QueueWrite =
  | { readonly ok: true }
  | { readonly ok: false; readonly problem: "write_failed" };

export interface OfflineQueue {
  /** Every item still waiting, oldest first. */
  read(): Promise<QueueRead>;
  /** Adds an item at the end. Adding an id already queued is a no-op that still answers ok. */
  add(item: QueueItem): Promise<QueueWrite>;
  /** Removes an item by id. Removing an id not queued is a no-op that still answers ok. */
  remove(id: string): Promise<QueueWrite>;
}

export const memoryQueue = (): OfflineQueue => {
  let items: QueueItem[] = [];
  return {
    async read() {
      return { ok: true, items: [...items] };
    },
    async add(item) {
      if (!items.some((existing) => existing.id === item.id)) items = [...items, item];
      return { ok: true };
    },
    async remove(id) {
      items = items.filter((existing) => existing.id !== id);
      return { ok: true };
    },
  };
};

/** The text of a file adapter, read and written whole. `read` answers null when nothing is stored yet. */
export interface FileIo {
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
  /** Moves the stored file aside (kept, not deleted) so a fresh queue can start. */
  setAside(): Promise<void>;
}

const FILE_VERSION = 1;

const plain = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Parses a stored file. `undefined` when the text is not a queue this app wrote. */
export function parseQueueFile(text: string): QueueItem[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
  if (!plain(parsed) || parsed.v !== FILE_VERSION || !Array.isArray(parsed.items)) return undefined;
  const items: QueueItem[] = [];
  for (const item of parsed.items) {
    if (
      !plain(item) ||
      typeof item.id !== "string" ||
      typeof item.community !== "string" ||
      !plain(item.event)
    ) {
      return undefined;
    }
    items.push({
      id: item.id,
      community: item.community,
      event: item.event as unknown as EventEnvelope,
    });
  }
  return items;
}

/**
 * A queue kept in one file. Every operation (read, add, remove) goes through one chain, so an operation starts only
 * after the one before it has finished its load and save (review P1). A failed write is reported, not thrown. An
 * unreadable file is moved aside and a fresh queue starts (review P6).
 */
export function createFileQueue(io: FileIo): OfflineQueue {
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const next = chain.then(task, task);
    chain = next.catch(() => undefined);
    return next;
  };

  async function load(): Promise<QueueRead> {
    const text = await io.read();
    if (text === null) return { ok: true, items: [] };
    const items = parseQueueFile(text);
    if (items !== undefined) return { ok: true, items };
    await io.setAside();
    return { ok: true, items: [], setAside: true };
  }

  async function save(items: readonly QueueItem[]): Promise<QueueWrite> {
    try {
      await io.write(JSON.stringify({ v: FILE_VERSION, items }));
      return { ok: true };
    } catch {
      return { ok: false, problem: "write_failed" };
    }
  }

  return {
    read: () => serial(load),
    add: (item) =>
      serial(async (): Promise<QueueWrite> => {
        const loaded = await load();
        if (!loaded.ok) return { ok: false, problem: "write_failed" };
        if (loaded.items.some((existing) => existing.id === item.id)) return { ok: true };
        return save([...loaded.items, item]);
      }),
    remove: (id) =>
      serial(async (): Promise<QueueWrite> => {
        const loaded = await load();
        if (!loaded.ok) return { ok: false, problem: "write_failed" };
        if (!loaded.items.some((existing) => existing.id === id)) return { ok: true };
        return save(loaded.items.filter((existing) => existing.id !== id));
      }),
  };
}
