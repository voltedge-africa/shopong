import {
  err,
  ok,
  type AppendError,
  type AppendReceipt,
  type ApplyHost,
  type Did,
  type EventId,
  type IdGenerator,
  type JsonValue,
  type RecordEntry,
  type Result,
  type SharedRecord,
  type Space,
  type SpaceDefinition,
  type SpaceKey,
  type Unsubscribe,
  type ViewChange,
  type ViewEntry,
  type ViewReader,
  type ViewWriter,
} from "@shopong/ports";
import { cloneJson, compareUtf8, createCounterIds } from "./support.js";

/** One appended entry with its causal context, like an Autobase node. */
interface StoredEntry<E> {
  readonly id: EventId;
  readonly writer: Did;
  /** Position in the writer's own log. */
  readonly seq: number;
  /** Length of every writer's log the appender had seen: the entry comes after all of those. */
  readonly deps: Readonly<Record<Did, number>>;
  readonly event: E;
}

interface PeerSpace<E> {
  readonly key: SpaceKey;
  readonly creator: Did;
  readonly local: Did;
  readonly definition: SpaceDefinition<E>;
  /** Writer DID to that writer's log. */
  readonly logs: Map<Did, StoredEntry<E>[]>;
  view: Map<string, JsonValue>;
  writers: Set<Did>;
  appliedOrder: string;
  applied: number;
  readonly listeners: Set<(change: ViewChange) => void>;
  closed: boolean;
}

/**
 * In-memory peers of a shared record, standing in for Corestore + Autobase + Hyperswarm.
 * Peers hold separate copies and only see each other's entries after `replicate`, so tests
 * can model offline writers and arbitrary arrival orders.
 */
export interface MemoryRecordNetwork {
  /** A peer whose local writer identity is `local`. One peer per DID. */
  peer<E>(local: Did): SharedRecord<E>;
  /** Exchange every entry both peers hold for this space, then update both views. */
  replicate<E>(a: Space<E>, b: Space<E>): Promise<void>;
}

export interface MemoryRecordNetworkOptions {
  ids?: IdGenerator;
}

export function createMemoryRecordNetwork(
  options: MemoryRecordNetworkOptions = {},
): MemoryRecordNetwork {
  const ids = options.ids ?? createCounterIds();
  const creators = new Map<SpaceKey, Did>();
  const states = new WeakMap<object, PeerSpace<unknown>>();

  function stateOf<E>(space: Space<E>): PeerSpace<E> {
    const state = states.get(space);
    if (state === undefined) throw new Error("not a space from this network");
    return state as PeerSpace<E>;
  }

  function peer<E>(local: Did): SharedRecord<E> {
    const open = new Map<SpaceKey, Space<E>>();

    function attach(key: SpaceKey, creator: Did, definition: SpaceDefinition<E>): Space<E> {
      const existing = open.get(key);
      if (existing !== undefined) return existing;
      const state: PeerSpace<E> = {
        key,
        creator,
        local,
        definition,
        logs: new Map(),
        view: new Map(),
        writers: new Set([creator]),
        appliedOrder: "",
        applied: 0,
        listeners: new Set(),
        closed: false,
      };
      const space = new MemorySpace(state);
      states.set(space, state as PeerSpace<unknown>);
      open.set(key, space);
      return space;
    }

    return {
      local,
      create: async (definition) => {
        const key = `mem-space:${ids.next("space")}`;
        creators.set(key, local);
        return attach(key, local, definition);
      },
      open: async (key, definition) => {
        const creator = creators.get(key);
        if (creator === undefined) throw new Error(`unknown space ${key}`);
        return attach(key, creator, definition);
      },
    };
  }

  async function replicate<E>(a: Space<E>, b: Space<E>): Promise<void> {
    const left = stateOf(a);
    const right = stateOf(b);
    if (left.key !== right.key) throw new Error("cannot replicate different spaces");
    merge(left, right);
    merge(right, left);
    await a.update();
    await b.update();
  }

  return { peer, replicate };
}

function merge<E>(into: PeerSpace<E>, from: PeerSpace<E>): void {
  for (const [writer, log] of from.logs) {
    const mine = into.logs.get(writer) ?? [];
    if (log.length > mine.length) into.logs.set(writer, [...mine, ...log.slice(mine.length)]);
  }
}

/**
 * Deterministic topological order: repeatedly take, among writers whose next entry has all
 * its dependencies emitted, the one with the smallest DID. The result depends only on the
 * set of entries, never on the order they arrived in.
 */
function linearise<E>(logs: Map<Did, StoredEntry<E>[]>): StoredEntry<E>[] {
  const writers = [...logs.keys()].sort(compareUtf8);
  const emitted = new Map<Did, number>(writers.map((w) => [w, 0]));
  const order: StoredEntry<E>[] = [];
  for (;;) {
    let next: StoredEntry<E> | undefined;
    for (const writer of writers) {
      const entry = logs.get(writer)?.[emitted.get(writer) ?? 0];
      if (entry === undefined) continue;
      const ready = Object.entries(entry.deps).every(
        ([dep, length]) => dep === writer || (emitted.get(dep as Did) ?? 0) >= length,
      );
      if (ready) {
        next = entry;
        break;
      }
    }
    if (next === undefined) return order;
    order.push(next);
    emitted.set(next.writer, (emitted.get(next.writer) ?? 0) + 1);
  }
}

function listView(view: Map<string, JsonValue>, prefix: string): ViewEntry[] {
  return [...view.entries()]
    .filter(([key]) => key.startsWith(prefix))
    .sort(([a], [b]) => compareUtf8(a, b))
    .map(([key, value]) => ({ key, value: cloneJson(value) }));
}

class MemorySpace<E> implements Space<E> {
  readonly #state: PeerSpace<E>;
  readonly view: ViewReader;

  constructor(state: PeerSpace<E>) {
    this.#state = state;
    this.view = {
      get: async (key) => {
        const value = state.view.get(key);
        return value === undefined ? undefined : cloneJson(value);
      },
      list: async (prefix) => listView(state.view, prefix),
    };
  }

  get key(): SpaceKey {
    return this.#state.key;
  }

  get local(): Did {
    return this.#state.local;
  }

  async writable(): Promise<boolean> {
    await this.update();
    return this.#state.writers.has(this.#state.local);
  }

  async writers(): Promise<readonly Did[]> {
    await this.update();
    return [...this.#state.writers].sort(compareUtf8);
  }

  async append(event: E): Promise<Result<AppendReceipt, AppendError>> {
    const state = this.#state;
    if (state.closed) return err("closed", "space is closed");
    if (!(await this.writable()))
      return err("not_writable", `${state.local} is not an admitted writer`);
    const id = await state.definition.eventId(event);
    for (const log of state.logs.values()) {
      if (log.some((entry) => entry.id === id)) return ok({ id, duplicate: true });
    }
    const deps: Record<Did, number> = {};
    for (const [writer, log] of state.logs) deps[writer] = log.length;
    const log = state.logs.get(state.local) ?? [];
    log.push({ id, writer: state.local, seq: log.length, deps, event });
    state.logs.set(state.local, log);
    await this.update();
    return ok({ id, duplicate: false });
  }

  async update(): Promise<void> {
    const state = this.#state;
    if (state.closed) return;
    const order = linearise(state.logs);
    const signature = order.map((entry) => entry.id).join(",");
    if (signature === state.appliedOrder) return;

    // Rebuild from scratch, as Autobase may when the linearised order changes.
    const view = new Map<string, JsonValue>();
    const writers = new Set<Did>([state.creator]);
    const seen = new Set<EventId>();
    const writer: ViewWriter = {
      get: async (key) => {
        const value = view.get(key);
        return value === undefined ? undefined : cloneJson(value);
      },
      list: async (prefix) => listView(view, prefix),
      put: async (key, value) => {
        view.set(key, cloneJson(value));
      },
      del: async (key) => {
        view.delete(key);
      },
    };
    const host: ApplyHost = {
      addWriter: async (did) => {
        writers.add(did);
      },
      removeWriter: async (did) => {
        if (did !== state.creator) writers.delete(did);
      },
    };
    let applied = 0;
    for (const entry of order) {
      if (!writers.has(entry.writer) || seen.has(entry.id)) continue;
      seen.add(entry.id);
      const record: RecordEntry<E> = { id: entry.id, writer: entry.writer, event: entry.event };
      await state.definition.apply([record], writer, host);
      applied++;
    }
    state.view = view;
    state.writers = writers;
    state.appliedOrder = signature;
    state.applied = applied;
    const change: ViewChange = { space: state.key, applied };
    for (const listener of state.listeners) listener(change);
  }

  subscribe(listener: (change: ViewChange) => void): Unsubscribe {
    this.#state.listeners.add(listener);
    return () => {
      this.#state.listeners.delete(listener);
    };
  }

  async close(): Promise<void> {
    this.#state.closed = true;
    this.#state.listeners.clear();
  }
}
