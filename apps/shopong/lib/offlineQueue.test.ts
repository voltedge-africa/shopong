// The queue's two adapters pass one contract (story 3.4).
import { describe, expect, it } from "vite-plus/test";
import { createFileQueue, memoryQueue, type FileIo } from "./offlineQueue";
import { runOfflineQueueContract, type QueueFixture } from "./offlineQueue.contract";

/** A file held in memory, standing in for the device's file. Each step yields, so overlapping calls really overlap. */
function fakeFile(initial: string | null = null) {
  let text = initial;
  let aside: string | null = null;
  const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  const io: FileIo = {
    read: async () => {
      await pause();
      return text;
    },
    write: async (next) => {
      await pause();
      text = next;
    },
    setAside: async () => {
      await pause();
      aside = text;
      text = null;
    },
  };
  return {
    io,
    stored: () => text,
    setAside: () => aside,
    corrupt: (value = "{not a queue") => (text = value),
  };
}

describe("offline queue adapters pass one contract (story 3.4)", () => {
  runOfflineQueueContract("memory", (): QueueFixture => ({ make: () => memoryQueue() }));

  runOfflineQueueContract("file", (): QueueFixture => {
    const file = fakeFile();
    return {
      make: () => createFileQueue(file.io),
      reopen: () => createFileQueue(file.io),
      corrupt: () => file.corrupt(),
      stored: () => file.stored(),
      setAside: () => file.setAside(),
    };
  });

  // Review P1: two operations that start together must not lose each other's change. Adds and removes are
  // launched in order, overlapping on the file; without one queue of operations the later save wins and drops
  // the earlier change.
  it("file: overlapping adds and removes, 1000 times, lose nothing", async () => {
    const file = fakeFile();
    const queue = createFileQueue(file.io);
    const pending: Promise<unknown>[] = [];
    const id = (n: number) => `event-${n}`;
    for (let n = 0; n < 1000; n++) {
      pending.push(
        queue.add({
          id: id(n),
          community: "c",
          event: { type: "member.joined", nonce: String(n) } as never,
        }),
      );
      // Every even item is removed right after it is added, while the add is still in flight.
      if (n % 2 === 0) pending.push(queue.remove(id(n)));
    }
    await Promise.all(pending);
    const read = await queue.read();
    if (!read.ok) throw new Error("should read");
    expect(read.items.map((item) => item.id)).toEqual(
      Array.from({ length: 500 }, (_, k) => id(2 * k + 1)),
    );
  });

  it("file: reads a file written by another run with the same shape", async () => {
    const file = fakeFile(
      JSON.stringify({
        v: 1,
        items: [{ id: "e1", community: "c", event: { type: "member.joined" } }],
      }),
    );
    const read = await createFileQueue(file.io).read();
    if (!read.ok) throw new Error("should read");
    expect(read.items).toHaveLength(1);
  });

  it("file: a file of another version or shape is set aside, not guessed at", async () => {
    for (const text of [
      JSON.stringify({ v: 2, items: [] }),
      JSON.stringify({ v: 1, items: [{ id: 3 }] }),
      JSON.stringify([]),
    ]) {
      const file = fakeFile(text);
      const read = await createFileQueue(file.io).read();
      expect(read).toEqual({ ok: true, items: [], setAside: true });
      expect(file.setAside()).toBe(text);
    }
  });
});
