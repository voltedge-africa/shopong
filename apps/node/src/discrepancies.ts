// The discrepancy list (story 10.3): every difference the reconciler finds between the record, the books (ledger) and
// the payment provider, with both sides' values and the event id, kept until a treasurer resolves it with a reason.
//
// SIMULATED payments only. Nothing here repays, reverses or edits the books, the record or the provider: a discrepancy
// is an entry in `discrepancies.json` and nothing else. A later run that no longer sees a difference does NOT close an
// entry: it stays visible until someone resolves it with a recorded reason (the epic's Done-when 2).
//
// The id of an entry is the SHA-512 of the canonical JSON of what it says (AGENTS rule 5 for the event id; the same
// rule for the discrepancy), so a repeated run finds the same entry and never opens a second copy of it.

import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { canonicalize } from "@shopong/events";
import type { Did } from "@shopong/ports";

export const DISCREPANCY_FILE = "discrepancies.json";
export const DISCREPANCY_FORMAT = "discrepancies/1";
/** The longest reason a treasurer may record. */
export const MAX_REASON_LENGTH = 500;

/** What the reconciler found, in the words the treasurer reads. Values are plain status words, never personal data. */
export interface DiscrepancyInput {
  readonly kind: string;
  /** The community the difference belongs to; absent when no pledge matches the payment. */
  readonly communityKey?: string;
  /** The event id that joins the three readings (AGENTS rule 5); the pledge's event id when no completion exists. */
  readonly eventId: string;
  /** What the shared record says, for example "paid" or "not shown as paid". */
  readonly record: string;
  /** What the books (ledger) say, for example "posted" or "not posted". */
  readonly books: string;
  /** What the payment provider says, for example "paid" or "pending". */
  readonly provider: string;
  /** The plain sentence shown to the treasurer. */
  readonly text: string;
}

export interface Resolution {
  readonly reason: string;
  readonly at: number;
  readonly by: Did;
}

export interface Discrepancy extends DiscrepancyInput {
  readonly id: string;
  readonly openedAt: number;
  readonly lastSeenAt: number;
  readonly resolution?: Resolution;
}

export type ResolveProblem =
  | "not_found"
  | "already_resolved"
  | "reason_required"
  | "reason_too_long";

export type ResolveResult =
  | { readonly ok: true; readonly item: Discrepancy }
  | { readonly ok: false; readonly problem: ResolveProblem };

interface DiscrepancyState {
  readonly format: typeof DISCREPANCY_FORMAT;
  readonly items: Discrepancy[];
}

/** The entry's id: SHA-512 (hex) of the canonical JSON of its facts. Two runs that find the same facts get one id. */
export function discrepancyIdOf(input: DiscrepancyInput): string {
  const facts = {
    kind: input.kind,
    communityKey: input.communityKey ?? null,
    eventId: input.eventId,
    record: input.record,
    books: input.books,
    provider: input.provider,
  };
  return createHash("sha512").update(canonicalize(facts), "utf8").digest("hex");
}

function isDiscrepancy(value: unknown): value is Discrepancy {
  if (typeof value !== "object" || value === null) return false;
  const d = value as Record<string, unknown>;
  const strings = ["id", "kind", "eventId", "record", "books", "provider", "text"] as const;
  if (!strings.every((key) => typeof d[key] === "string")) return false;
  if (typeof d.openedAt !== "number" || typeof d.lastSeenAt !== "number") return false;
  if (d.communityKey !== undefined && typeof d.communityKey !== "string") return false;
  if (d.resolution === undefined) return true;
  const r = d.resolution as Record<string, unknown>;
  return typeof r.reason === "string" && typeof r.at === "number" && typeof r.by === "string";
}

/**
 * The file of discrepancies in the data folder. A file that cannot be read is moved aside to `<file>.bad` and the list
 * starts empty: a corrupt list must not stop the Node (the same rule as the checking list, story 4.5).
 */
export class DiscrepancyStore {
  readonly #file: string;
  #state: DiscrepancyState;

  constructor(file: string, log?: (message: string) => void) {
    this.#file = file;
    this.#state = { format: DISCREPANCY_FORMAT, items: [] };
    if (!existsSync(file)) return;
    let loaded: DiscrepancyState | undefined;
    try {
      const s = JSON.parse(readFileSync(file, "utf8")) as Partial<DiscrepancyState> | null;
      const valid =
        typeof s === "object" &&
        s !== null &&
        s.format === DISCREPANCY_FORMAT &&
        Array.isArray(s.items) &&
        s.items.every(isDiscrepancy);
      if (valid) loaded = { format: DISCREPANCY_FORMAT, items: [...(s!.items as Discrepancy[])] };
    } catch {
      loaded = undefined;
    }
    if (loaded !== undefined) {
      this.#state = loaded;
      return;
    }
    renameSync(file, `${file}.bad`);
    log?.(
      `${DISCREPANCY_FILE} could not be read and was moved aside to ${DISCREPANCY_FILE}.bad; the discrepancy list starts empty (simulated)`,
    );
  }

  /** Every entry, open and resolved, in the order they were first opened. */
  list(): readonly Discrepancy[] {
    return this.#state.items;
  }

  /**
   * Opens an entry for each difference, or refreshes `lastSeenAt` on the entry it already has. Returns how many entries
   * were new. Entries are never removed here.
   */
  open(inputs: readonly DiscrepancyInput[], at: number): number {
    const items = [...this.#state.items];
    let created = 0;
    let changed = false;
    for (const input of inputs) {
      const id = discrepancyIdOf(input);
      const index = items.findIndex((item) => item.id === id);
      if (index === -1) {
        items.push({ ...input, id, openedAt: at, lastSeenAt: at });
        created += 1;
        changed = true;
      } else if (items[index]!.lastSeenAt !== at) {
        items[index] = { ...items[index]!, lastSeenAt: at };
        changed = true;
      }
    }
    if (changed) this.#change({ format: DISCREPANCY_FORMAT, items });
    return created;
  }

  /**
   * Resolves an open entry with a recorded reason. The reason is required (after trimming) and at most
   * MAX_REASON_LENGTH characters. Nothing else changes: the books, the record and the provider are left as they are.
   */
  resolve(id: string, reason: string, by: Did, at: number): ResolveResult {
    const index = this.#state.items.findIndex((item) => item.id === id);
    if (index === -1) return { ok: false, problem: "not_found" };
    const text = reason.trim();
    if (text === "") return { ok: false, problem: "reason_required" };
    if (text.length > MAX_REASON_LENGTH) return { ok: false, problem: "reason_too_long" };
    const current = this.#state.items[index]!;
    if (current.resolution !== undefined) return { ok: false, problem: "already_resolved" };
    const item: Discrepancy = { ...current, resolution: { reason: text, at, by } };
    const items = [...this.#state.items];
    items[index] = item;
    this.#change({ format: DISCREPANCY_FORMAT, items });
    return { ok: true, item };
  }

  #change(next: DiscrepancyState): void {
    const before = this.#state;
    this.#state = next;
    try {
      this.#persist();
    } catch (error) {
      this.#state = before;
      throw error;
    }
  }

  /** Writes the whole list to a temporary file, fsyncs it, renames it over the old one, then syncs the folder. */
  #persist(): void {
    const temp = `${this.#file}.tmp`;
    const bytes = Buffer.from(JSON.stringify(this.#state), "utf8");
    const fd = openSync(temp, "w", 0o600);
    try {
      let written = 0;
      while (written < bytes.length) {
        const n = writeSync(fd, bytes, written, bytes.length - written);
        if (n <= 0) throw new Error("discrepancy file: a write wrote no bytes");
        written += n;
      }
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, this.#file);
    // The rename is only durable once the folder is synced (as the checking list does, story 4.5).
    const dir = openSync(dirname(this.#file), "r");
    try {
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }
  }
}

export function openDiscrepancyStore(
  dataDir: string,
  log?: (message: string) => void,
): DiscrepancyStore {
  return new DiscrepancyStore(join(dataDir, DISCREPANCY_FILE), log);
}
