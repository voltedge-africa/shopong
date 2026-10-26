// The SharedRecord port on Autobase and Hyperbee (story 3.2). It runs in the OCN Node, on disk.
//
// One Corestore per record, a namespace per space (decision 3A), a view that is a Hyperbee. Each space
// is one Autobase. `apply` is the community's own `apply`, called entry by entry, with two things the
// adapter adds, both written into the view so every replica agrees:
//   - `_sys/*` keys: the creator, each member's writer key (`_sys/key/<did>`), the owner of each writer key
//     (`_sys/owner/<hex>`), who is admitted (`_sys/writer/<did>`) and which event ids are logged
//     (`_sys/logged/<id>`). Keys under `_sys/` are never shown through the port.
//   - the genesis node, which the creator appends first, so the creator's key maps to its DID.
// The writer key of a joining member is derived from the master key, the space key and the DID (keys.ts).
// Only the Node holds the master key, so only the Node can write as a member (decision 2A).

import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import b4a from "b4a";
import {
  err,
  ok,
  type AppendError,
  type AppendReceipt,
  type Did,
  type EventId,
  type JsonValue,
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
import { corestorePrimaryKey, writerCoreKey, writerKeyPair } from "./keys.js";

// The Hyper packages ship no type declarations, so they are loaded through CommonJS and typed here for
// the calls this package makes. Everything they return stays behind the SharedRecord port.
const requireCjs = createRequire(import.meta.url);
const Autobase = requireCjs("autobase") as new (
  store: any,
  bootstrap: Uint8Array | null,
  options: Record<string, unknown>,
) => any;
const Corestore = requireCjs("corestore") as new (
  dir: string,
  options: Record<string, unknown>,
) => any;
const Hyperbee = requireCjs("hyperbee") as new (
  core: unknown,
  options: Record<string, unknown>,
) => any;

const RESERVED = "_sys/";
const CREATOR = "_sys/creator";
const WRITER_PREFIX = "_sys/writer/";
const keyOf = (did: string): string => `_sys/key/${did}`;
const ownerOf = (hex: string): string => `_sys/owner/${hex}`;
const writerOf = (did: string): string => `_sys/writer/${did}`;
const loggedOf = (id: string): string => `_sys/logged/${id}`;

/** What an Autobase node carries. */
type Stored<E> =
  | { readonly t: "genesis"; readonly creator: Did }
  | { readonly t: "event"; readonly id: EventId; readonly event: E };

interface SpaceIndexEntry {
  /** The Corestore namespace holding this space. */
  readonly ns: string;
  /** The DID that created the space on this Node, or null when this Node joined it. */
  readonly creator: Did | null;
}

type SpaceIndex = Record<SpaceKey, SpaceIndexEntry>;

export interface AutobaseRecordOptions {
  /** The identity this peer writes as. */
  readonly local: Did;
  /** The Node's data folder. Everything is stored under it. */
  readonly dataDir: string;
  /** 32 bytes from the Node's secrets. Never stored in the record. */
  readonly masterKey: Uint8Array;
}

/** A SharedRecord that also releases its files. */
export interface AutobaseSharedRecord<E> extends SharedRecord<E> {
  close(): Promise<void>;
}

export async function openAutobaseRecord<E>(
  options: AutobaseRecordOptions,
): Promise<AutobaseSharedRecord<E>> {
  if (options.masterKey.byteLength !== 32) throw new TypeError("the master key must be 32 bytes");
  // Owner only: the data folder holds the record's keys and files (set when created; an existing folder is left as it is).
  mkdirSync(options.dataDir, { recursive: true, mode: 0o700 });
  // `unsafe` acknowledges that the primary key is derived from the master key and kept in the data folder
  // (the spike's AD-18 finding: the primary key is plaintext at rest). See the shortcut register.
  const store = new Corestore(options.dataDir, {
    primaryKey: corestorePrimaryKey(options.masterKey),
    unsafe: true,
  });
  await store.ready();
  const env: Env = { store, dir: options.dataDir, master: options.masterKey, local: options.local };
  const spaces = new Set<AutobaseSpace<E>>();

  return {
    local: options.local,

    async create(definition: SpaceDefinition<E>): Promise<Space<E>> {
      const ns = randomBytes(16).toString("hex");
      const space = new AutobaseSpace<E>(env, definition);
      const base = new Autobase(store.namespace(ns), null, space.handlers());
      space.start(base);
      await base.ready();
      space.setKey(b4a.toString(base.key, "hex"));
      const index = readIndex(env.dir);
      index[space.key] = { ns, creator: env.local };
      writeIndex(env.dir, index);
      spaces.add(space);
      await base.append({ t: "genesis", creator: env.local } satisfies Stored<E>);
      await base.update();
      return space;
    },

    async open(key: SpaceKey, definition: SpaceDefinition<E>): Promise<Space<E>> {
      const index = readIndex(env.dir);
      let entry = index[key];
      if (entry === undefined) {
        entry = { ns: randomBytes(16).toString("hex"), creator: null };
        index[key] = entry;
        writeIndex(env.dir, index);
      }
      // The creator's writer key is the space key itself, which Autobase keeps on disk. A joining
      // member's writer key is derived, so every replica can name it.
      const keyPair =
        entry.creator === env.local ? undefined : writerKeyPair(env.master, key, env.local);
      const space = new AutobaseSpace<E>(env, definition);
      space.setKey(key);
      const base = new Autobase(store.namespace(entry.ns), b4a.from(key, "hex"), {
        ...space.handlers(),
        ...(keyPair === undefined ? {} : { keyPair }),
      });
      space.start(base);
      await base.ready();
      spaces.add(space);
      return space;
    },

    async close(): Promise<void> {
      for (const space of spaces) await space.close();
      await store.close();
    },
  };
}

interface Env {
  readonly store: any;
  readonly dir: string;
  readonly master: Uint8Array;
  readonly local: Did;
}

/**
 * Test seam: runs a space's `apply` over hand-built nodes, against the given view and host, so the
 * guards (unknown keys, id checks, admission order) can be tested without a second replica.
 */
export async function applyNodesForTest(
  space: Space<unknown>,
  nodes: unknown[],
  view: unknown,
  host: unknown,
): Promise<void> {
  if (!(space instanceof AutobaseSpace)) throw new Error("not a space from this adapter");
  await space.applyNodes(nodes, view, host);
}

/** The Autobase behind a space that this adapter opened; used by the test support to replicate. */
export function baseOf(space: Space<unknown>): Autobase {
  if (!(space instanceof AutobaseSpace)) throw new Error("not a space from this adapter");
  return space.base;
}

type Autobase = any;

function readIndex(dir: string): SpaceIndex {
  const path = join(dir, "spaces.json");
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as SpaceIndex) : {};
}

function writeIndex(dir: string, index: SpaceIndex): void {
  const path = join(dir, "spaces.json");
  writeFileSync(`${path}.tmp`, JSON.stringify(index), { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}

/** One value from the Hyperbee view, or undefined. Reserved keys are readable here, for the adapter. */
async function read(hb: any, key: string): Promise<JsonValue | undefined> {
  const node = await hb.get(key);
  return node === null ? undefined : (node.value as JsonValue);
}

/** Keys with the prefix, ascending by UTF-8 bytes (Hyperbee's order), reserved keys excluded. */
async function list(hb: any, prefix: string): Promise<ViewEntry[]> {
  const out: ViewEntry[] = [];
  for await (const node of hb.createReadStream({ gte: prefix })) {
    if (!node.key.startsWith(prefix)) break;
    if (node.key.startsWith(RESERVED)) continue;
    out.push({ key: node.key, value: node.value as JsonValue });
  }
  return out;
}

/** Keys with the prefix including reserved ones, for the adapter's own bookkeeping. */
async function scanKeys(hb: any, prefix: string): Promise<string[]> {
  const out: string[] = [];
  for await (const node of hb.createReadStream({ gte: prefix })) {
    if (!node.key.startsWith(prefix)) break;
    out.push(node.key);
  }
  return out;
}

class AutobaseSpace<E> implements Space<E> {
  readonly #env: Env;
  readonly #definition: SpaceDefinition<E>;
  readonly #listeners = new Set<(change: ViewChange) => void>();
  #key: SpaceKey = "";
  #base: Autobase = null;
  #applied = 0;
  #closed = false;
  readonly view: ViewReader;

  constructor(env: Env, definition: SpaceDefinition<E>) {
    this.#env = env;
    this.#definition = definition;
    this.view = {
      get: async (key) => (key.startsWith(RESERVED) ? undefined : read(this.#hb(), key)),
      list: async (prefix) => list(this.#hb(), prefix),
    };
  }

  get key(): SpaceKey {
    return this.#key;
  }

  get local(): Did {
    return this.#env.local;
  }

  get base(): Autobase {
    return this.#base;
  }

  setKey(key: SpaceKey): void {
    this.#key = key;
  }

  start(base: Autobase): void {
    this.#base = base;
  }

  #hb(): any {
    return this.#base.view;
  }

  /** The Autobase options: the view is a Hyperbee, and `apply` is this space's. */
  handlers(): Record<string, unknown> {
    return {
      valueEncoding: "json",
      ackInterval: 0,
      open: (store: any) =>
        new Hyperbee(store.get({ name: "view" }), {
          keyEncoding: "utf-8",
          valueEncoding: "json",
        }),
      apply: (nodes: any[], view: any, host: any) => this.applyNodes(nodes, view, host),
    };
  }

  /** The `apply` of this space, over the given nodes. Only `applyNodesForTest` calls it from outside. */
  async applyNodes(nodes: any[], hb: any, host: any): Promise<void> {
    let applied = 0;
    for (const node of nodes) {
      const stored = node.value as Stored<E> | null;
      if (stored === null || stored === undefined) continue; // an Autobase acknowledgement
      const from = b4a.toString(node.from.key, "hex");

      if (stored.t === "genesis") {
        // Only the bootstrap writer (the space's own key) can create the space, and only once.
        if (!b4a.equals(node.from.key, this.#base.key)) continue;
        if ((await read(hb, CREATOR)) !== undefined) continue;
        await hb.put(CREATOR, stored.creator);
        await this.#bind(hb, stored.creator, from);
        continue;
      }
      if (stored.t !== "event") continue;

      const writer = await read(hb, ownerOf(from));
      if (typeof writer !== "string") continue; // a key with no DID in the view: never applied
      // The id is recomputed from the event, never trusted from the entry (AGENTS.md rule 5).
      const id = await this.#definition.eventId(stored.event);
      if (id !== stored.id) continue;
      // Admission is checked before the id is logged, so an unadmitted writer cannot use up an id.
      if ((await read(hb, writerOf(writer))) === undefined) continue;
      if ((await read(hb, loggedOf(id))) !== undefined) continue; // an event id is applied once
      await hb.put(loggedOf(id), true);

      const entries = [{ id, writer: writer as Did, event: stored.event }];
      await this.#definition.apply(entries, viewWriter(hb), this.#host(hb, host));
      applied++;
    }
    if (applied > 0) {
      this.#applied += applied;
      const change: ViewChange = { space: this.#key, applied: this.#applied };
      for (const listener of this.#listeners) listener(change);
    }
  }

  /** Record a member's writer key and admission in the view. */
  async #bind(hb: any, did: Did, hex: string): Promise<void> {
    await hb.put(keyOf(did), hex);
    await hb.put(ownerOf(hex), did);
    await hb.put(writerOf(did), true);
  }

  #host(hb: any, host: any) {
    const env = this.#env;
    return {
      addWriter: async (did: Did): Promise<void> => {
        const known = await read(hb, keyOf(did));
        if (typeof known === "string") {
          // Admitted before (and possibly removed since): the core must be linearised again, or its entries never apply.
          await host.addWriter(b4a.from(known, "hex"));
        } else {
          // The key is derived from the master key, the space and the DID, so every replica computes the same one.
          const core = writerCoreKey(env.master, this.#key, did, env.store.manifestVersion);
          await host.addWriter(core);
          await this.#bind(hb, did, b4a.toString(core, "hex"));
          return;
        }
        await hb.put(writerOf(did), true);
      },
      removeWriter: async (did: Did): Promise<void> => {
        if ((await read(hb, CREATOR)) === did) return; // the creator cannot be removed
        const hex = await read(hb, keyOf(did));
        if (typeof hex === "string") {
          const key = b4a.from(hex, "hex");
          if (host.removeable(key)) await host.removeWriter(key);
        }
        await hb.del(writerOf(did));
      },
    };
  }

  async update(): Promise<void> {
    if (this.#closed) return;
    await this.#base.update();
  }

  async writable(): Promise<boolean> {
    await this.update();
    return (await read(this.#hb(), writerOf(this.#env.local))) !== undefined;
  }

  async writers(): Promise<readonly Did[]> {
    await this.update();
    const keys = await scanKeys(this.#hb(), WRITER_PREFIX);
    return keys.map((k) => k.slice(WRITER_PREFIX.length) as Did).sort();
  }

  async append(event: E): Promise<Result<AppendReceipt, AppendError>> {
    if (this.#closed) return err("closed", "space is closed");
    if (!(await this.writable())) {
      return err("not_writable", `${this.#env.local} is not an admitted writer`);
    }
    const id = await this.#definition.eventId(event);
    if ((await read(this.#hb(), loggedOf(id))) !== undefined) return ok({ id, duplicate: true });
    await this.#base.append({ t: "event", id, event } satisfies Stored<E>);
    await this.update();
    return ok({ id, duplicate: false });
  }

  subscribe(listener: (change: ViewChange) => void): Unsubscribe {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#listeners.clear();
    await this.#base.close();
  }
}

/** The view a community's `apply` writes through: reserved keys are refused. */
function viewWriter(hb: any): ViewWriter {
  const refuse = (key: string) => {
    if (key.startsWith(RESERVED)) throw new Error(`the view key ${key} is reserved`);
  };
  return {
    get: async (key) => (key.startsWith(RESERVED) ? undefined : read(hb, key)),
    list: (prefix) => list(hb, prefix),
    put: async (key, value) => {
      refuse(key);
      await hb.put(key, value);
    },
    del: async (key) => {
      refuse(key);
      await hb.del(key);
    },
  };
}
