// The Node's place registry and route store (story 7.4). Both are kept on the Node's disk in the data folder and are
// never sent in an event: a place's exact coordinates and a route's line stay here, and members see the line over a
// signed read. The record holds only the opaque place id, the label, the area and the commitment of the address.
//
// Each file is rewritten whole, with an fsync, before its rename, and the memory copy changes only after that write has
// succeeded. A file that cannot be read is moved aside to `<name>.bad` with one plain log line, and the Node starts with
// that store empty rather than stopping.

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
import { dirname, join } from "node:path";

export const PLACES_FILE = "places.json";
export const ROUTES_FILE = "routes.json";

export interface PlaceEntry {
  readonly label: string;
  readonly area: string;
  readonly lat: number;
  readonly lng: number;
  readonly addressCommitment: string;
}

export interface RouteEntry {
  readonly origin: string;
  readonly destination: string;
  readonly polyline6: string;
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly costing: string;
  readonly tileRelease: string;
  readonly plannedBy: string;
}

type Table<T> = Map<string, Map<string, T>>;

/** One JSON file of `community key -> id -> entry`. */
class DurableJson<T> {
  readonly #path: string | undefined;
  readonly #log: (line: string) => void;
  #data: Table<T> = new Map();

  constructor(path: string | undefined, log: (line: string) => void) {
    this.#path = path;
    this.#log = log;
    if (path === undefined || !existsSync(path)) return;
    try {
      this.#data = parseTable<T>(readFileSync(path, "utf8"));
    } catch {
      // Moved aside, never deleted, so the data can be looked at. The Node carries on with an empty store.
      renameSync(path, `${path}.bad`);
      this.#log(
        `quarantined ${path} (not readable); it was moved to ${path}.bad and the store starts empty`,
      );
    }
  }

  get(community: string, id: string): T | undefined {
    return this.#data.get(community)?.get(id);
  }

  /** Every entry of one community, in the order they were first kept. */
  entries(community: string): [string, T][] {
    return [...(this.#data.get(community) ?? new Map<string, T>()).entries()];
  }

  /** Writes the whole table first; memory changes only once the file is on disk. Throws when the write fails. */
  put(community: string, id: string, entry: T): void {
    const next: Table<T> = new Map(
      [...this.#data].map(([c, entries]) => [c, new Map(entries)] as const),
    );
    const entries = next.get(community) ?? new Map<string, T>();
    entries.set(id, entry);
    next.set(community, entries);
    if (this.#path !== undefined) writeDurably(this.#path, next);
    this.#data = next;
  }
}

function parseTable<T>(text: string): Table<T> {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("not a table");
  }
  const table: Table<T> = new Map();
  for (const [community, entries] of Object.entries(parsed)) {
    if (typeof entries !== "object" || entries === null || Array.isArray(entries)) {
      throw new Error("not a table");
    }
    table.set(community, new Map(Object.entries(entries as Record<string, T>)));
  }
  return table;
}

function writeDurably<T>(path: string, table: Table<T>): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const body: Record<string, Record<string, T>> = {};
  for (const [community, entries] of table) body[community] = Object.fromEntries(entries);
  const temp = `${path}.tmp`;
  const fd = openSync(temp, "w", 0o600);
  try {
    writeSync(fd, JSON.stringify(body));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, path);
}

/** The places a community routes to. Ids are opaque: 32 random bytes, hex. */
export class PlaceRegistry {
  readonly #store: DurableJson<PlaceEntry>;

  constructor(dataDir: string | undefined, log: (line: string) => void = () => undefined) {
    this.#store = new DurableJson<PlaceEntry>(
      dataDir === undefined ? undefined : join(dataDir, PLACES_FILE),
      log,
    );
  }

  /** Keeps a place under its id. The caller derives the id from the registration (see `placeIdOf`), so a retry is the same place. */
  put(community: string, id: string, entry: PlaceEntry): void {
    this.#store.put(community, id, entry);
  }

  get(community: string, id: string): PlaceEntry | undefined {
    return /^[0-9a-f]{64}$/.test(id) ? this.#store.get(community, id) : undefined;
  }

  /** The places of one community, with their ids. Members read them; the coordinates are the Node's own. */
  list(community: string): [string, PlaceEntry][] {
    return this.#store.entries(community);
  }
}

/** The routes planned for a community, by order and fingerprint, so two orders never overwrite each other's route. */
export class RouteStore {
  readonly #store: DurableJson<RouteEntry>;

  constructor(dataDir: string | undefined, log: (line: string) => void = () => undefined) {
    this.#store = new DurableJson<RouteEntry>(
      dataDir === undefined ? undefined : join(dataDir, ROUTES_FILE),
      log,
    );
  }

  put(community: string, order: string, fingerprint: string, entry: RouteEntry): void {
    this.#store.put(community, routeId(order, fingerprint), entry);
  }

  get(community: string, order: string, fingerprint: string): RouteEntry | undefined {
    if (!/^[0-9a-f]{128}$/.test(fingerprint)) return undefined;
    return this.#store.get(community, routeId(order, fingerprint));
  }
}

const routeId = (order: string, fingerprint: string) =>
  `${encodeURIComponent(order)}/${fingerprint}`;
