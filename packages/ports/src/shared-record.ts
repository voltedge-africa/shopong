import type { Did, EventId, JsonValue, PortError, Result, Unsubscribe } from "./common.js";

/** Public key of a community space (the Autobase key for the Hyper* adapter). */
export type SpaceKey = string;

/** One event as `apply` sees it, after linearisation. */
export interface RecordEntry<E> {
  readonly id: EventId;
  /** The writer that appended it. */
  readonly writer: Did;
  readonly event: E;
}

/** Read access to the view, inside and outside `apply`. Keys sort by UTF-8 bytes. */
export interface ViewReader {
  get(key: string): Promise<JsonValue | undefined>;
  /** Every entry whose key starts with `prefix`, in ascending key order. */
  list(prefix: string): Promise<readonly ViewEntry[]>;
}

/** Write access to the view, only inside `apply`. */
export interface ViewWriter extends ViewReader {
  put(key: string, value: JsonValue): Promise<void>;
  del(key: string): Promise<void>;
}

export interface ViewEntry {
  readonly key: string;
  readonly value: JsonValue;
}

/** Writer management, only inside `apply` (Autobase `host`). */
export interface ApplyHost {
  /** Admit a writer. Call this only after a capability check on the admitting event. */
  addWriter(writer: Did): Promise<void>;
  /** Remove a writer. The space's creator cannot be removed. */
  removeWriter(writer: Did): Promise<void>;
}

/**
 * Builds the view from linearised entries. It must be deterministic (AGENTS.md rule 3):
 * no wall clock, no network, no randomness, no environment reads, and the same view for
 * the same entries however they are split into batches. It may be re-run from the start
 * when the linearised order changes, so it must not have effects outside `view` and `host`.
 * Entries from writers that are not admitted at that point in the order are never passed in,
 * and no event id is passed in twice.
 */
export type Apply<E> = (
  entries: readonly RecordEntry<E>[],
  view: ViewWriter,
  host: ApplyHost,
) => Promise<void>;

export interface SpaceDefinition<E> {
  readonly apply: Apply<E>;
  /** The event id (SHA-512 of the canonical JSON); supplied by `@shopong/events`. */
  readonly eventId: (event: E) => EventId | Promise<EventId>;
}

export type AppendError = PortError<"not_writable" | "closed">;

export interface AppendReceipt {
  readonly id: EventId;
  /** True if an event with this id was already in the log; nothing new was appended. */
  readonly duplicate: boolean;
}

/** Emitted after the view has changed. */
export interface ViewChange {
  readonly space: SpaceKey;
  /** Number of entries applied to the view so far. */
  readonly applied: number;
}

/** One community's replicated record, as seen from one peer. */
export interface Space<E> {
  readonly key: SpaceKey;
  /** The local writer identity. */
  readonly local: Did;
  /** Whether `local` is currently an admitted writer. */
  writable(): Promise<boolean>;
  /** The currently admitted writers, sorted. */
  writers(): Promise<readonly Did[]>;
  /** Append an event to the local writer's log. Works offline. */
  append(event: E): Promise<Result<AppendReceipt, AppendError>>;
  /** Apply everything this peer already holds to the view. Resolves when done. */
  update(): Promise<void>;
  /** The view. Reflects the last completed `update` (or automatic update). */
  readonly view: ViewReader;
  /** Called after the view changes. No ordering or batching is promised. */
  subscribe(listener: (change: ViewChange) => void): Unsubscribe;
  close(): Promise<void>;
}

/**
 * The shared community record: multi-writer, offline-first, replicated, with a
 * deterministic view. Generic over the event type so it does not depend on the event
 * envelope package. Owning epic: 3.
 *
 * Writers are identified by DID; the Hyper* adapter maps a DID to its Autobase writer
 * key (both derive from the member's identity seed, AD-18).
 *
 * Guarantees every adapter must give:
 * - Convergence: peers holding the same set of entries have identical views, whatever
 *   order the entries arrived in.
 * - Idempotency: appending an event whose id is already in the log is a no-op.
 * - Admission: only writers admitted through `ApplyHost.addWriter` (starting with the
 *   space's creator) contribute entries to the view.
 */
export interface SharedRecord<E> {
  /** The local identity of this peer. */
  readonly local: Did;
  /** Create a new space with `local` as its creator and first writer. */
  create(definition: SpaceDefinition<E>): Promise<Space<E>>;
  /** Open an existing space. It fills in as entries replicate. */
  open(key: SpaceKey, definition: SpaceDefinition<E>): Promise<Space<E>>;
}
