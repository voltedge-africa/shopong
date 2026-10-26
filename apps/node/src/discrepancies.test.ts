// The discrepancy list (story 10.3): ids, opening without duplicates, nothing closed by a later run, resolution with a
// recorded reason, and the file across a restart. SIMULATED payments only.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import {
  DiscrepancyStore,
  discrepancyIdOf,
  DISCREPANCY_FILE,
  MAX_REASON_LENGTH,
  type DiscrepancyInput,
} from "./discrepancies.ts";

const folder = mkdtempSync(join(tmpdir(), "ocn-discrepancies-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

const TREASURER = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
const EVENT = "a".repeat(128);

const input = (overrides: Partial<DiscrepancyInput> = {}): DiscrepancyInput => ({
  kind: "bank_paid_not_in_books",
  communityKey: "c".repeat(64),
  eventId: EVENT,
  record: "not shown as paid",
  books: "not posted",
  provider: "paid",
  text: "The simulated bank shows a R500.00 payment as paid, but the pool books do not have it. (simulated)",
  ...overrides,
});

describe("discrepancy ids (story 10.3)", () => {
  it("is the SHA-512 hex of the facts: the same facts give the same id, and any changed fact gives a new one", () => {
    const id = discrepancyIdOf(input());
    expect(id).toMatch(/^[0-9a-f]{128}$/u);
    expect(discrepancyIdOf(input({ text: "different wording" }))).toBe(id);
    expect(discrepancyIdOf(input({ books: "posted" }))).not.toBe(id);
    expect(discrepancyIdOf(input({ provider: "pending" }))).not.toBe(id);
    expect(discrepancyIdOf(input({ eventId: "b".repeat(128) }))).not.toBe(id);
    expect(discrepancyIdOf(input({ communityKey: undefined }))).not.toBe(id);
  });
});

describe("opening discrepancies (story 10.3)", () => {
  it("opens each difference once: a repeat run refreshes lastSeenAt and adds no copy", () => {
    const store = new DiscrepancyStore(join(folder, "open.json"));
    expect(store.open([input()], 1)).toBe(1);
    expect(store.open([input()], 2)).toBe(0);
    const [only] = store.list();
    expect(store.list()).toHaveLength(1);
    expect(only!.openedAt).toBe(1);
    expect(only!.lastSeenAt).toBe(2);
    expect(only!.resolution).toBeUndefined();
  });

  it("never closes an entry when a later run no longer sees the difference", () => {
    const store = new DiscrepancyStore(join(folder, "stays.json"));
    store.open([input()], 1);
    store.open([], 2);
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]!.resolution).toBeUndefined();
  });

  it("keeps the event id, both sides' values and the plain sentence on the entry", () => {
    const store = new DiscrepancyStore(join(folder, "shape.json"));
    store.open([input()], 1);
    const [item] = store.list();
    expect(item).toMatchObject({
      kind: "bank_paid_not_in_books",
      eventId: EVENT,
      record: "not shown as paid",
      books: "not posted",
      provider: "paid",
    });
    expect(item!.text).toContain("(simulated)");
  });
});

describe("resolving discrepancies (story 10.3)", () => {
  it("resolves an open entry with a recorded reason, trimmed, and keeps it listed", () => {
    const store = new DiscrepancyStore(join(folder, "resolve.json"));
    store.open([input()], 1);
    const id = store.list()[0]!.id;
    const result = store.resolve(
      id,
      "  Bank statement shows the R500 arrived on 3 Oct.  ",
      TREASURER,
      5,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item.resolution).toEqual({
      reason: "Bank statement shows the R500 arrived on 3 Oct.",
      at: 5,
      by: TREASURER,
    });
    expect(store.list()).toHaveLength(1);
    expect(result.item.eventId).toBe(EVENT);
  });

  it("refuses an empty reason, an over-long reason, an unknown id and a second resolution", () => {
    const store = new DiscrepancyStore(join(folder, "refuse.json"));
    store.open([input()], 1);
    const id = store.list()[0]!.id;
    expect(store.resolve(id, "   ", TREASURER, 2)).toEqual({
      ok: false,
      problem: "reason_required",
    });
    expect(store.resolve(id, "x".repeat(MAX_REASON_LENGTH + 1), TREASURER, 2)).toEqual({
      ok: false,
      problem: "reason_too_long",
    });
    expect(store.resolve("f".repeat(128), "reason", TREASURER, 2)).toEqual({
      ok: false,
      problem: "not_found",
    });
    expect(store.resolve(id, "first reason", TREASURER, 3).ok).toBe(true);
    expect(store.resolve(id, "second reason", TREASURER, 4)).toEqual({
      ok: false,
      problem: "already_resolved",
    });
    expect(store.list()[0]!.resolution?.reason).toBe("first reason");
  });

  it("a refused resolution changes nothing on disk", () => {
    const file = join(folder, "unchanged.json");
    const store = new DiscrepancyStore(file);
    store.open([input()], 1);
    const before = readFileSync(file, "utf8");
    store.resolve(store.list()[0]!.id, "", TREASURER, 2);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("keeps the resolution across a restart, reading the same file again", () => {
    const file = join(folder, "restart.json");
    const first = new DiscrepancyStore(file);
    first.open([input()], 1);
    first.resolve(first.list()[0]!.id, "checked with the treasurer", TREASURER, 9);
    const again = new DiscrepancyStore(file);
    expect(again.list()).toHaveLength(1);
    expect(again.list()[0]!.resolution?.reason).toBe("checked with the treasurer");
  });
});

describe("the discrepancy file (story 10.3)", () => {
  it("moves a corrupt file aside, logs it in plain words, and starts with an empty list", () => {
    const file = join(folder, DISCREPANCY_FILE);
    writeFileSync(file, "{not json");
    const lines: string[] = [];
    const store = new DiscrepancyStore(file, (line) => lines.push(line));
    expect(store.list()).toEqual([]);
    expect(existsSync(`${file}.bad`)).toBe(true);
    expect(lines.join("\n")).toContain("moved aside");
    expect(lines.join("\n")).toContain("(simulated)");
  });
});
