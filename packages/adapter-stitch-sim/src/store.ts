// The simulation's state: every payment request and disbursement, the late completions, and the ids. It is kept in
// memory and, when a state file is given, written to it after every change with fsync and then rename (the way
// `communities.json` is written). A change is committed only once its write succeeds: if the write throws, the state
// goes back to what it was, so memory never runs ahead of the file (review item 5). The webhook key is never written,
// and neither is a beneficiary's account number (only the amount, the references and a keyed fingerprint).
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import type { HmacSha512 } from "@shopong/events";
import {
  isEventId,
  isMoney,
  type Clock,
  type EpochMs,
  type EventId,
  type Money,
  type PaymentStatus,
} from "@shopong/ports";
import { signBody, signatureValid } from "./signature.js";
import { payInBody, payOutBody, type Kind, type TerminalOutcome } from "./stitch-shape.js";

/** Named in every log line and every message a person could see. */
export const SIMULATED_MODE = "simulated-stitch";
export const LOG_TAG = "[simulated Stitch]";
export const STATE_FORMAT = "simulated-stitch/1";

const STATUSES: readonly PaymentStatus[] = [
  "pending",
  "completed",
  "cancelled",
  "expired",
  "failed",
];

export interface StoredPayment {
  readonly id: string;
  readonly kind: Kind;
  status: PaymentStatus;
  readonly amount: Money;
  readonly externalReference: EventId;
  /** Pay-ins only. */
  readonly expireAt?: EpochMs;
  /** Keyed fingerprint of the create request, for idempotency. Not the request itself. */
  readonly fingerprint: string;
}

/** A completion that arrived after its request expired. Never applied; kept for reconciliation (plan OQ 7). */
export interface LateCompletion {
  readonly paymentId: string;
  readonly kind: "pay_in";
  readonly status: "expired";
  readonly amount: Money;
  readonly flaggedAt: EpochMs;
}

export interface StoreOptions {
  readonly webhookKey: Uint8Array;
  readonly hmac: HmacSha512;
  readonly clock?: Clock;
  /** JSON state file. Omitted: the state lives in memory for this process only. */
  readonly stateFile?: string;
  /** Receives every log line; each one is prefixed with `LOG_TAG`. */
  readonly log?: (line: string) => void;
}

interface FileState {
  readonly format: string;
  readonly records: readonly StoredPayment[];
  readonly lateCompletions: readonly LateCompletion[];
}

function isRecord(value: unknown): value is StoredPayment {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r["id"] === "string" &&
    (r["kind"] === "pay_in" || r["kind"] === "pay_out") &&
    STATUSES.includes(r["status"] as PaymentStatus) &&
    isMoney(r["amount"]) &&
    isEventId(r["externalReference"]) &&
    typeof r["fingerprint"] === "string" &&
    (r["expireAt"] === undefined || Number.isSafeInteger(r["expireAt"]))
  );
}

function isLate(value: unknown): value is LateCompletion {
  if (typeof value !== "object" || value === null) return false;
  const l = value as Record<string, unknown>;
  return (
    typeof l["paymentId"] === "string" &&
    isMoney(l["amount"]) &&
    Number.isSafeInteger(l["flaggedAt"])
  );
}

/** Reads the state file. Errors name the file and the rule, never the content. */
function readState(file: string): FileState | undefined {
  if (!existsSync(file)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error(`simulated Stitch state file ${file} cannot be read: it is not valid JSON`);
  }
  const s = parsed as Partial<FileState> | null;
  const valid =
    typeof s === "object" &&
    s !== null &&
    s.format === STATE_FORMAT &&
    Array.isArray(s.records) &&
    s.records.every(isRecord) &&
    Array.isArray(s.lateCompletions) &&
    s.lateCompletions.every(isLate);
  if (!valid) {
    throw new Error(`simulated Stitch state file ${file} is not in format ${STATE_FORMAT}`);
  }
  return s as FileState;
}

/** A short, one-way reference to a payment id, for logs. The id is a capability on the bank page: never logged. */
export function requestRef(id: string): string {
  return createHash("sha256").update(id).digest("hex").slice(0, 12);
}

/** Shared state for the simulated PayIn and PayOut: one file, one webhook key. */
export class SimulatedStore {
  readonly #records = new Map<string, StoredPayment>();
  readonly #byReference = new Map<string, string>();
  readonly #late: LateCompletion[] = [];
  readonly #key: Uint8Array;
  readonly #hmac: HmacSha512;
  readonly #clock: Clock;
  readonly #file: string | undefined;
  readonly #log: ((line: string) => void) | undefined;

  constructor(options: StoreOptions) {
    this.#key = options.webhookKey;
    this.#hmac = options.hmac;
    this.#clock = options.clock ?? { now: () => Date.now() };
    this.#file = options.stateFile;
    this.#log = options.log;
    const loaded = this.#file === undefined ? undefined : readState(this.#file);
    if (loaded !== undefined) {
      for (const record of loaded.records) this.#index(record);
      this.#late.push(...loaded.lateCompletions);
    }
  }

  #index(record: StoredPayment): void {
    this.#records.set(record.id, record);
    this.#byReference.set(`${record.kind}\n${record.externalReference}`, record.id);
  }

  now(): EpochMs {
    return this.#clock.now();
  }

  /**
   * A fresh id: 128 random bits. On the simulated bank page the id is the capability, so it must not be guessable
   * (review item 1). Sequential ids are never issued.
   */
  nextId(kind: Kind): string {
    return `${kind === "pay_in" ? "pir" : "pout"}_${randomBytes(16).toString("hex")}`;
  }

  get(id: string, kind: Kind): StoredPayment | undefined {
    const record = this.#records.get(id);
    return record?.kind === kind ? record : undefined;
  }

  /** Every stored record of one kind, in no particular order. */
  all(kind: Kind): StoredPayment[] {
    return [...this.#records.values()].filter((r) => r.kind === kind);
  }

  /** The request already made with this external reference, for the same kind. */
  byReference(kind: Kind, reference: EventId): StoredPayment | undefined {
    const id = this.#byReference.get(`${kind}\n${reference}`);
    return id === undefined ? undefined : this.#records.get(id);
  }

  add(record: StoredPayment): void {
    this.#transact(() => this.#index(record));
  }

  /** Every change to a stored status goes through here, so it is written at once or not at all. */
  setStatus(record: StoredPayment, status: PaymentStatus): void {
    this.#transact(() => {
      record.status = status;
    });
  }

  lateCompletions(): readonly LateCompletion[] {
    return [...this.#late];
  }

  isFlagged(paymentId: string): boolean {
    return this.#late.some((l) => l.paymentId === paymentId);
  }

  flagLate(record: StoredPayment, amount: Money): void {
    this.#transact(() => {
      this.#late.push({
        paymentId: record.id,
        kind: "pay_in",
        status: "expired",
        amount,
        flaggedAt: this.now(),
      });
    });
  }

  /**
   * Applies `change`, then writes the state. If the write throws, the state is restored to what it was before the
   * change and the error is rethrown: nothing is applied that was not written.
   */
  #transact(change: () => void): void {
    const before = {
      records: new Map([...this.#records].map(([id, r]) => [id, { ...r }] as const)),
      refs: new Map(this.#byReference),
      late: [...this.#late],
    };
    change();
    try {
      this.persist();
    } catch (error) {
      this.#records.clear();
      for (const [id, r] of before.records) this.#records.set(id, r);
      this.#byReference.clear();
      for (const [k, id] of before.refs) this.#byReference.set(k, id);
      this.#late.splice(0, this.#late.length, ...before.late);
      throw error;
    }
  }

  /** Keyed fingerprint of a create request: the same request gives the same value, a changed one does not. */
  async fingerprint(kind: Kind, request: unknown): Promise<string> {
    const text = `simulated Stitch request ${kind}\n${stableStringify(request)}`;
    const mac = await this.#hmac(this.#key, new TextEncoder().encode(text));
    return Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  async sign(body: string): Promise<string> {
    return signBody(this.#hmac, this.#key, body);
  }

  verify(headers: { readonly [name: string]: string }, body: string): Promise<boolean> {
    return signatureValid(this.#hmac, this.#key, headers, body);
  }

  /** A body for the processor's test mode: what Stitch would send for this outcome. */
  body(kind: Kind, outcome: TerminalOutcome, record: StoredPayment): string {
    return kind === "pay_in"
      ? payInBody(outcome, record.id, record.externalReference, record.amount)
      : payOutBody(outcome, record.id, record.externalReference, record.amount);
  }

  log(message: string): void {
    this.#log?.(`${LOG_TAG} ${message}`);
  }

  /** Writes the whole state: temporary file, fsync, then rename over the old one. */
  persist(): void {
    if (this.#file === undefined) return;
    mkdirSync(dirname(this.#file), { recursive: true });
    const state: FileState = {
      format: STATE_FORMAT,
      records: [...this.#records.values()],
      lateCompletions: this.#late,
    };
    const temp = `${this.#file}.tmp`;
    const fd = openSync(temp, "w", 0o600);
    try {
      writeFileSync(fd, JSON.stringify(state));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, this.#file);
  }
}

/** Sorted keys, for comparing request bodies. Not the event canonicaliser. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .filter((key) => record[key] !== undefined)
        .map((key) => [key, sortKeys(record[key])]),
    );
  }
  return value;
}
