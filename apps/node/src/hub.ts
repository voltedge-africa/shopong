// The replica hub (story 3.5, option A of the product owner's blocker decision, see the plan's change log).
//
// Autobase allows one local writer per replica, so the Node cannot append as several phones on one record.
// Instead the Node keeps one replica per admitted member, in its own store under the data folder, opened as that
// member with the derived keys (`open()`). Each member replica is joined over a persistent in-process pipe to the
// Node's indexer replica, which is the seeder and the only indexer for Demonstration 1. An append is written to
// the signer's own replica and acknowledged once it is durable there. A pull reads the indexer's journal, after
// waiting (bounded) for the indexer to hold the caller's own acknowledged appends.
//
// Only an admitted member has anything on the Node's disk: a stranger costs a registry read and nothing else.
// Every open is shared: concurrent first requests wait for one open, not two. A failed join is rolled back, so a
// later call retries it.
//
// The community's registry (community key, Autobase key, creator, admitted members) is kept in `communities.json`
// in the data folder, checked when the hub is made, and written with an fsync before its rename.
//
// A removal is read from the record, not from this registry (story 3.3): when the indexer's view shows
// `removed/<did>`, the member is not a member for the Node (no pull, no append, no replica), and the Node closes
// that member's replica for the community. A fresh invitation clears the marker, and the member's replica opens
// again on their next call. The registry keeps the admission list the Node was given.

import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { communityDefinition, type Community, type CommunityDeps } from "@shopong/community";
import { webCryptoSha512, type EventEnvelope } from "@shopong/events";
import {
  connectSpaces,
  hasApplied,
  journalHead,
  journalSince,
  openAutobaseRecord,
  type AutobaseSharedRecord,
  type ConnectOptions,
  type JournalEntry,
} from "@shopong/record-autobase";
import type { CapabilityAuth, Did, Space, Unsubscribe, ViewChange } from "@shopong/ports";
import type { ReadResult, SyncHub } from "./sync.ts";

const MEMBERS_DIR = "members";
/** The record's marker for a removed member, cleared by a fresh invitation (story 3.3). */
const REMOVED_PREFIX = "removed/";
const REGISTRY_FILE = "communities.json";
const POLL_MS = 10;
const SETTLE_ROUNDS = 4;
const SETTLE_DEADLINE_MS = 10_000;
/** How long a pull waits for the indexer to hold the caller's own acknowledged appends. */
const DEFAULT_READ_WAIT_MS = 2_000;

interface Registration {
  /** The Autobase key of the community's space (64 hex). */
  readonly spaceKey: string;
  readonly creator: Did;
  /** The admitted members. Only these have a replica on this Node. */
  members: Did[];
}

type Registry = Record<string, Registration>;

/** A member's space for one community, and the pipe joining it to the indexer. */
interface MemberSpace {
  readonly space: Space<EventEnvelope>;
  disconnect: () => void;
}

interface MemberReplica {
  readonly record: AutobaseSharedRecord<EventEnvelope>;
  /** Community key to the member's own space. Each entry is shared by every caller that asks for it. */
  readonly spaces: Map<string, Promise<MemberSpace>>;
}

export interface ReplicaHubOptions {
  /** The Node's data folder. Replicas and the registry live under it. */
  readonly dataDir: string;
  /** The 32-byte master key. Only the Node holds it. */
  readonly masterKey: Uint8Array;
  /** The Node's indexer replica (the seeder): opened by the record component. */
  readonly indexer: AutobaseSharedRecord<unknown>;
  readonly auth: CapabilityAuth;
  /** How long a pull waits for the caller's own appends to reach the indexer. Default 2 s. */
  readonly readWaitMs?: number;
  /** Test seams: how a record is opened, and how a member's replica is joined to the indexer. */
  readonly openRecord?: typeof openAutobaseRecord;
  readonly connect?: (
    a: Space<EventEnvelope>,
    b: Space<EventEnvelope>,
    options?: ConnectOptions,
  ) => () => void;
  readonly connectOptions?: ConnectOptions;
}

/** Reads and checks the registry once. A file that cannot be read is refused by name. */
function loadRegistry(dir: string): Registry {
  const path = join(dir, REGISTRY_FILE);
  if (!existsSync(path)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    throw new Error(`${path} cannot be read: it is not valid JSON`);
  }
  const plain = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  const valid =
    plain(parsed) &&
    Object.values(parsed).every(
      (entry) =>
        plain(entry) &&
        typeof entry.spaceKey === "string" &&
        /^[0-9a-f]{64}$/u.test(entry.spaceKey) &&
        typeof entry.creator === "string" &&
        Array.isArray(entry.members) &&
        entry.members.every((m) => typeof m === "string"),
    );
  if (!valid) throw new Error(`${path} cannot be read: it does not hold the community registry`);
  return parsed as Registry;
}

/** Holds the admitted members' replicas and the indexer replica for every community the Node serves. */
export class ReplicaHub implements SyncHub {
  readonly #options: ReplicaHubOptions;
  readonly #indexer: AutobaseSharedRecord<EventEnvelope>;
  readonly #deps: Pick<CommunityDeps, "auth" | "sha512">;
  readonly #openRecord: typeof openAutobaseRecord;
  readonly #members = new Map<Did, Promise<MemberReplica>>();
  readonly #indexed = new Map<string, Promise<Space<EventEnvelope>>>();
  /** Acknowledged appends a member has not yet seen in the indexer, by member and community. */
  readonly #pending = new Map<string, Set<string>>();
  readonly #registry: Registry;

  constructor(options: ReplicaHubOptions) {
    this.#options = options;
    this.#indexer = options.indexer as AutobaseSharedRecord<EventEnvelope>;
    this.#deps = { auth: options.auth, sha512: webCryptoSha512 };
    this.#openRecord = options.openRecord ?? openAutobaseRecord;
    this.#registry = loadRegistry(options.dataDir);
  }

  #saveRegistry(): void {
    const path = join(this.#options.dataDir, REGISTRY_FILE);
    const temp = `${path}.tmp`;
    const fd = openSync(temp, "w", 0o600);
    try {
      writeSync(fd, JSON.stringify(this.#registry));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, path);
  }

  #definition(communityKey: string, creator: Did) {
    return communityDefinition(this.#deps, creator, communityKey);
  }

  /** Admits a person as a member of a registered community. Only admitted members get a replica. */
  async admitMember(communityKey: string, did: Did): Promise<void> {
    const entry = this.#registry[communityKey];
    if (entry === undefined) throw new Error("community is not registered");
    if (!entry.members.includes(did)) {
      entry.members.push(did);
      this.#saveRegistry();
    }
  }

  /**
   * Records a community the creator made on `recordOf(creator)`, and keeps the creator's own space. Registering
   * again merges the members: nobody already on the list is dropped.
   */
  async register(community: Community): Promise<void> {
    const existing = this.#registry[community.key];
    const members = [...new Set([...(existing?.members ?? []), community.creator])];
    this.#registry[community.key] = {
      spaceKey: community.space.key,
      creator: community.creator,
      members,
    };
    this.#saveRegistry();
    await this.#slot(community.creator, community.key, community.space);
  }

  /** Whether the member has an open replica of the community (true from the first call until a removal closes it). */
  async holdsReplica(did: Did, communityKey: string): Promise<boolean> {
    const pending = this.#members.get(did);
    if (pending === undefined) return false;
    try {
      return (await pending).spaces.has(communityKey);
    } catch {
      return false;
    }
  }

  /** The member's record: a replica in its own store, opened once and shared. */
  async recordOf(did: Did): Promise<AutobaseSharedRecord<EventEnvelope>> {
    return (await this.#memberOf(did)).record;
  }

  #memberOf(did: Did): Promise<MemberReplica> {
    let member = this.#members.get(did);
    if (member === undefined) {
      member = this.#openMember(did);
      this.#members.set(did, member);
      member.catch(() => {
        if (this.#members.get(did) === member) this.#members.delete(did);
      });
    }
    return member;
  }

  async #openMember(did: Did): Promise<MemberReplica> {
    const dir = join(
      this.#options.dataDir,
      MEMBERS_DIR,
      createHash("sha256").update(did).digest("hex").slice(0, 32),
    );
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const record = await this.#openRecord<EventEnvelope>({
      local: did,
      dataDir: dir,
      masterKey: this.#options.masterKey,
    });
    return { record, spaces: new Map() };
  }

  /** The member's space for a community, opened and joined once; `adopted` is a space the caller already holds. */
  #slot(did: Did, communityKey: string, adopted?: Space<EventEnvelope>): Promise<MemberSpace> {
    const entry = this.#registry[communityKey];
    if (entry === undefined) return Promise.reject(new Error("community is not registered"));
    return this.#memberOf(did).then((member) => {
      let slot = member.spaces.get(communityKey);
      if (slot === undefined) {
        slot = this.#openSlot(did, member, communityKey, entry, adopted);
        member.spaces.set(communityKey, slot);
      }
      return slot;
    });
  }

  async #openSlot(
    did: Did,
    member: MemberReplica,
    communityKey: string,
    entry: Registration,
    adopted: Space<EventEnvelope> | undefined,
  ): Promise<MemberSpace> {
    try {
      const space =
        adopted ??
        (await member.record.open(entry.spaceKey, this.#definition(communityKey, entry.creator)));
      const slot: MemberSpace = { space, disconnect: () => {} };
      slot.disconnect = await this.#join(communityKey, space);
      return slot;
    } catch (error) {
      // Roll back: forget this slot and close the replica, so the next call opens it again and retries the join.
      member.spaces.delete(communityKey);
      await this.releaseReplica(did);
      throw error;
    }
  }

  /** The member's replica as a replica of the community, joined to the indexer. Undefined for anyone not admitted. */
  async replicaOf(did: Did, communityKey: string): Promise<Space<EventEnvelope> | undefined> {
    if (!(await this.isMember(did, communityKey))) return undefined;
    return (await this.#slot(did, communityKey)).space;
  }

  /** The indexer's copy of a community, opened once and shared, or undefined when the Node holds no such community. */
  #indexedOf(communityKey: string): Promise<Space<EventEnvelope>> | undefined {
    const entry = this.#registry[communityKey];
    if (entry === undefined) return undefined;
    let indexed = this.#indexed.get(communityKey);
    if (indexed === undefined) {
      indexed = this.#indexer
        .open(entry.spaceKey, this.#definition(communityKey, entry.creator))
        .then((space) => {
          // Every change to the record is checked for removals, so a removed member's replica closes at once.
          space.subscribe(() => {
            this.#releaseRemoved(communityKey).catch(() => {});
          });
          return space;
        });
      this.#indexed.set(communityKey, indexed);
      indexed.catch(() => {
        if (this.#indexed.get(communityKey) === indexed) this.#indexed.delete(communityKey);
      });
    }
    return indexed;
  }

  async #join(communityKey: string, space: Space<EventEnvelope>): Promise<() => void> {
    const indexed = this.#indexedOf(communityKey);
    if (indexed === undefined) throw new Error("community is not registered");
    return (this.#options.connect ?? connectSpaces)(
      space,
      await indexed,
      this.#options.connectOptions,
    );
  }

  /**
   * Closes the replica of each member the indexer's record shows as removed, and forgets it for that community. A
   * member's replica that serves no other community is closed with it.
   */
  async #releaseRemoved(communityKey: string): Promise<void> {
    const indexed = this.#indexedOf(communityKey);
    if (indexed === undefined) return;
    for (const row of await (await indexed).view.list(REMOVED_PREFIX)) {
      await this.#releaseSlot(row.key.slice(REMOVED_PREFIX.length) as Did, communityKey);
    }
  }

  async #releaseSlot(did: Did, communityKey: string): Promise<void> {
    const pending = this.#members.get(did);
    if (pending === undefined) return;
    let member: MemberReplica;
    try {
      member = await pending;
    } catch {
      return;
    }
    const slot = member.spaces.get(communityKey);
    if (slot === undefined) return;
    member.spaces.delete(communityKey);
    try {
      const { space, disconnect } = await slot;
      disconnect();
      // The space is closed as well as disconnected, so no instance of it stays open after a removal (story 3.3).
      await space.close();
    } catch {
      // A slot that never joined has nothing to close.
    }
    if (member.spaces.size === 0) await this.releaseReplica(did);
  }

  /** Every member's replica of a community that the record does not show as removed, opened (once) and joined. */
  async #replicasOf(communityKey: string): Promise<Space<EventEnvelope>[]> {
    const entry = this.#registry[communityKey];
    if (entry === undefined) return [];
    const current: Did[] = [];
    for (const did of entry.members) {
      if (await this.isMember(did, communityKey)) current.push(did);
    }
    const slots = await Promise.all(current.map((did) => this.#slot(did, communityKey)));
    return slots.map((slot) => slot.space);
  }

  /**
   * Replication settles: lengths stop moving on the indexer and the replicas. Used when the Node stops and by
   * tests that set a community up. Reads do not use it; they wait for the caller's own appends instead.
   */
  async catchUp(communityKey: string): Promise<void> {
    const indexed = this.#indexedOf(communityKey);
    if (indexed === undefined) return;
    const all = [await indexed, ...(await this.#replicasOf(communityKey))];
    let last = "";
    let stable = 0;
    const deadline = Date.now() + SETTLE_DEADLINE_MS;
    while (stable < SETTLE_ROUNDS) {
      for (const space of all) await space.update();
      const signature = (await Promise.all(all.map((s) => journalHead(s)))).join("/");
      stable = signature === last ? stable + 1 : 0;
      last = signature;
      if (stable < SETTLE_ROUNDS) {
        if (Date.now() > deadline) throw new Error("replication did not settle");
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    }
    // Only once the indexer holds every removal that has replicated, so a removed member's replica closes here.
    await this.#releaseRemoved(communityKey);
  }

  acknowledge(did: Did, communityKey: string, id: string): void {
    const key = `${did}\n${communityKey}`;
    let ids = this.#pending.get(key);
    if (ids === undefined) {
      ids = new Set();
      this.#pending.set(key, ids);
    }
    ids.add(id);
  }

  async readSince(
    did: Did,
    communityKey: string,
    after: number,
    limit: number,
  ): Promise<ReadResult> {
    if (this.#registry[communityKey] === undefined) return { ok: false, problem: "not_held" };
    if (!(await this.isMember(did, communityKey))) return { ok: false, problem: "not_member" };

    const indexed = await this.#indexedOf(communityKey)!;
    await this.#replicasOf(communityKey);

    // Read your writes, bounded: wait until the indexer holds every append this member was acknowledged, or
    // until the wait runs out, and then say `behind` so the phone pulls again.
    const key = `${did}\n${communityKey}`;
    const pending = this.#pending.get(key) ?? new Set<string>();
    const deadline = Date.now() + (this.#options.readWaitMs ?? DEFAULT_READ_WAIT_MS);
    let behind = false;
    for (;;) {
      await indexed.update();
      for (const id of pending) {
        if (await hasApplied(indexed, id as never)) pending.delete(id);
      }
      if (pending.size === 0) break;
      if (Date.now() >= deadline) {
        behind = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    if (pending.size === 0) this.#pending.delete(key);

    const entries = (await journalSince(indexed, after, limit)) as JournalEntry<EventEnvelope>[];
    return { ok: true, entries, head: await journalHead(indexed), behind };
  }

  /**
   * Admitted by the Node's list and not removed in the record. A removal wins until a fresh invitation clears it.
   */
  async isMember(did: Did, communityKey: string): Promise<boolean | undefined> {
    const entry = this.#registry[communityKey];
    if (entry === undefined) return undefined;
    if (!entry.members.includes(did)) return false;
    const indexed = await this.#indexedOf(communityKey)!;
    await indexed.update();
    return (await indexed.view.get(`${REMOVED_PREFIX}${did}`)) === undefined;
  }

  async onChange(
    communityKey: string,
    listener: (change: ViewChange) => void,
  ): Promise<Unsubscribe | undefined> {
    const indexed = this.#indexedOf(communityKey);
    if (indexed === undefined) return undefined;
    return (await indexed).subscribe(listener);
  }

  /** Stops a member's replica: its pipes close and it is forgotten. Its files stay in the data folder (story 3.3). */
  async releaseReplica(did: Did): Promise<void> {
    const pending = this.#members.get(did);
    if (pending === undefined) return;
    this.#members.delete(did);
    let member: MemberReplica;
    try {
      member = await pending;
    } catch {
      return;
    }
    for (const slot of member.spaces.values()) {
      try {
        (await slot).disconnect();
      } catch {
        // A slot that never joined has nothing to disconnect.
      }
    }
    await member.record.close();
  }

  /** Settles replication into the indexer, then closes the pipes and the replicas. */
  async close(): Promise<void> {
    for (const communityKey of this.#indexed.keys()) await this.catchUp(communityKey);
    for (const did of this.#members.keys()) await this.releaseReplica(did);
    this.#indexed.clear();
    this.#pending.clear();
  }
}
