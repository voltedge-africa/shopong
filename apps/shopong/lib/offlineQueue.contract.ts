// The contract every offline queue adapter passes (story 3.4; AGENTS rule 1). Each adapter's test file runs this.
import { expect, it } from "vite-plus/test";
import type { EventEnvelope } from "@shopong/events";
import type { OfflineQueue, QueueItem } from "./offlineQueue";

export interface QueueFixture {
  /** A fresh, empty queue. */
  make(): OfflineQueue;
  /** Another queue over the same storage, as after an app restart. Memory adapters have none. */
  reopen?(): OfflineQueue;
  /** Replaces the stored bytes with something that is not a queue. Adapters with storage only. */
  corrupt?(): void;
  /** The stored bytes, and the bytes set aside when the stored ones could not be read. Adapters with storage only. */
  stored?(): string | null;
  setAside?(): string | null;
}

const itemFor = (n: number): QueueItem => ({
  id: `event-${n}`,
  community: "a".repeat(64),
  event: {
    v: 1,
    type: "member.joined",
    space: "a".repeat(64),
    nonce: `n${n}`,
  } as unknown as EventEnvelope,
});

export function runOfflineQueueContract(name: string, fixture: () => QueueFixture): void {
  it(`${name}: starts empty`, async () => {
    const queue = fixture().make();
    expect(await queue.read()).toEqual({ ok: true, items: [] });
  });

  it(`${name}: keeps arrivals in order and returns them oldest first`, async () => {
    const queue = fixture().make();
    for (const n of [1, 2, 3]) expect((await queue.add(itemFor(n))).ok).toBe(true);
    const read = await queue.read();
    if (!read.ok) throw new Error("should read");
    expect(read.items.map((item) => item.id)).toEqual(["event-1", "event-2", "event-3"]);
  });

  it(`${name}: adding the same event id twice keeps one copy and still answers ok`, async () => {
    const queue = fixture().make();
    expect((await queue.add(itemFor(7))).ok).toBe(true);
    expect((await queue.add(itemFor(7))).ok).toBe(true);
    const read = await queue.read();
    if (!read.ok) throw new Error("should read");
    expect(read.items).toHaveLength(1);
  });

  it(`${name}: removes an item by id, and removing a missing id is a no-op`, async () => {
    const queue = fixture().make();
    await queue.add(itemFor(1));
    await queue.add(itemFor(2));
    expect((await queue.remove("event-1")).ok).toBe(true);
    expect((await queue.remove("never-queued")).ok).toBe(true);
    const read = await queue.read();
    if (!read.ok) throw new Error("should read");
    expect(read.items.map((item) => item.id)).toEqual(["event-2"]);
  });

  it(`${name}: returns the event envelope unchanged`, async () => {
    const queue = fixture().make();
    await queue.add(itemFor(4));
    const read = await queue.read();
    if (!read.ok) throw new Error("should read");
    expect(read.items[0]).toEqual(itemFor(4));
  });

  it(`${name}: a stored queue survives a restart`, async () => {
    const f = fixture();
    if (f.reopen === undefined) return;
    await f.make().add(itemFor(9));
    const read = await f.reopen().read();
    if (!read.ok) throw new Error("should read");
    expect(read.items.map((item) => item.id)).toEqual(["event-9"]);
  });

  it(`${name}: an unreadable store is set aside, a fresh queue starts, and the bytes are kept`, async () => {
    const f = fixture();
    if (f.corrupt === undefined || f.stored === undefined || f.setAside === undefined) return;
    const queue = f.make();
    f.corrupt();
    const bad = f.stored();
    const read = await queue.read();
    expect(read).toEqual({ ok: true, items: [], setAside: true });
    expect(f.setAside()).toBe(bad);
    expect((await queue.add(itemFor(5))).ok).toBe(true);
    const after = await queue.read();
    if (!after.ok) throw new Error("should read");
    expect(after.items.map((item) => item.id)).toEqual(["event-5"]);
  });
}
