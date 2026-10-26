// The phone's files (story 3.7): the bytes go to the Node before the event is queued; offline the bytes wait and
// nothing is queued; a refused upload leaves nothing behind; a fetched file is verified before it is shown or cached.
import { describe, expect, it } from "vite-plus/test";
import { checkFileBytes, toBase64, type EventEnvelope } from "@shopong/events";
import type { Did } from "@shopong/ports";
import { cacheNameOf, memoryByteStore, type ByteStore } from "./byteStore";
import { createAttachmentService, labelOf, type AttachmentDeps } from "./attachments";
import type { NodeClient } from "./nodeClient";
import type { SyncService } from "./sync";
import { sha512 } from "./sha512";

const DID = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK" as Did;
const KEY = "a".repeat(64);
const ascii = (text: string) => Array.from(text, (ch) => ch.charCodeAt(0));
const u16 = (n: number) => [(n >> 8) & 255, n & 255];

/** A JPEG with EXIF GPS and a time, then a scan. */
function jpegWithGps(): Uint8Array {
  const exif = [
    ...ascii("Exif\0\0"),
    ...ascii("GPSLatitude 26.2041 S GPSLongitude 28.0473 E 2026:10:26 09:14:02"),
  ];
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe1,
    ...u16(exif.length + 2),
    ...exif,
    0xff,
    0xda,
    ...u16(4),
    0x01,
    0x02,
    0x11,
    0x22,
    0xff,
    0xd9,
  ]);
}

type Reply<T> = { ok: true; value: T } | { ok: false; failure: { kind: string; reason: string } };

/** A Node that keeps what it is sent, and can be made offline or to refuse. */
function fakeNode(options: { offline?: boolean; refuse?: string; emptyRead?: boolean } = {}) {
  const kept = new Map<string, Uint8Array>();
  const uploads: { key: string; sha512: string; bytes: Uint8Array; purpose: string }[] = [];
  let online = !options.offline;
  const log: string[] = [];
  const node = {
    async uploadFile(
      key: string,
      file: { sha512: string; purpose: string; type: string; bytes: Uint8Array },
    ): Promise<Reply<{ sha512: string; duplicate: boolean }>> {
      log.push("upload");
      if (!online)
        return { ok: false, failure: { kind: "offline", reason: "No answer from the OCN Node." } };
      if (options.refuse !== undefined)
        return { ok: false, failure: { kind: "refused", reason: options.refuse } };
      uploads.push({ key, sha512: file.sha512, bytes: file.bytes, purpose: file.purpose });
      const duplicate = kept.has(file.sha512);
      kept.set(file.sha512, file.bytes);
      return { ok: true, value: { sha512: file.sha512, duplicate } };
    },
    async readFile(_key: string, hash: string): Promise<Reply<{ bytes: string }>> {
      log.push("read");
      if (options.emptyRead === true) return { ok: true, value: { bytes: "" } };
      const bytes = kept.get(hash);
      if (!online || bytes === undefined)
        return { ok: false, failure: { kind: "offline", reason: "No answer." } };
      return { ok: true, value: { bytes: toBase64(bytes) } };
    },
  };
  return {
    node: node as unknown as NodeClient,
    kept,
    uploads,
    log,
    setOnline(value: boolean) {
      online = value;
    },
    tamper(hash: string, bytes: Uint8Array) {
      kept.set(hash, bytes);
    },
  };
}

function fakeSync(log: string[]) {
  const queued: { community: string; event: EventEnvelope }[] = [];
  const sync = {
    async enqueue(community: string, event: EventEnvelope) {
      log.push("enqueue");
      queued.push({ community, event });
      return { ok: true as const, id: `id-${queued.length}` };
    },
    async flush() {
      return { result: "connected", pending: 0 };
    },
  };
  return { sync: sync as unknown as SyncService, queued };
}

function setup(
  options: { offline?: boolean; refuse?: string; emptyRead?: boolean; cacheCapBytes?: number } = {},
) {
  const net = fakeNode(options);
  const sy = fakeSync(net.log);
  const pending: ByteStore = memoryByteStore();
  const cache: ByteStore = memoryByteStore();
  const deps: AttachmentDeps = {
    node: net.node,
    sync: sy.sync,
    pending,
    cache,
    did: DID,
    sha512: async (bytes) => sha512(bytes),
    viewOf: () => undefined,
    now: () => 1_793_000_000_000,
    randomBytes: (n) => new Uint8Array(n).fill(7),
    ...(options.cacheCapBytes === undefined ? {} : { cacheCapBytes: options.cacheCapBytes }),
  };
  const service = createAttachmentService(deps);
  return { net, sy, pending, cache, service };
}

describe("a file the phone attaches", () => {
  it("sends its bytes to the Node before the event is queued, and the event names the bytes it sent", async () => {
    const { net, sy, service } = setup();
    await service.start();
    const result = await service.attach(KEY, "March stock", "delivery-photo", {
      name: "front.jpg",
      bytes: jpegWithGps(),
    });
    expect(result.ok).toBe(true);
    expect(net.log).toEqual(["upload", "enqueue"]);
    const sent = net.uploads[0]!;
    const text = String.fromCharCode(...sent.bytes);
    expect(text).not.toContain("GPS");
    expect(text).not.toContain("Exif");
    const queued = sy.queued[0]!.event;
    expect(queued.type).toBe("file.attached");
    expect((queued.payload as { hash: string }).hash).toBe(sent.sha512);
    expect(sent.sha512).toBe(
      Array.from(sha512(sent.bytes), (b) => b.toString(16).padStart(2, "0")).join(""),
    );
  });

  it("offline: the bytes wait on the phone, nothing is queued, and the sending waits until the Node answers", async () => {
    const { net, sy, pending, service } = setup({ offline: true });
    await service.start();
    const result = await service.attach(KEY, "March stock", "delivery-photo", {
      name: "front.jpg",
      bytes: jpegWithGps(),
    });
    expect(result.ok).toBe(true);
    expect(sy.queued).toHaveLength(0);
    const rows = service.filesFor(KEY, "March stock");
    expect(rows.map((r) => r.state)).toEqual(["waiting"]);
    const hash = rows[0]!.hash;
    expect(await pending.read(hash)).toBeDefined();

    net.setOnline(true);
    await service.retryPending();
    expect(sy.queued).toHaveLength(1);
    expect(service.filesFor(KEY, "March stock").map((r) => r.state)).toEqual(["saved"]);
    expect(await pending.read(hash)).toBeUndefined();
  });

  it("a refusal from the Node is said plainly, and nothing is queued or kept waiting", async () => {
    const { sy, pending, service } = setup({
      refuse: "Only a driver can attach a delivery photo.",
    });
    await service.start();
    const result = await service.attach(KEY, "March stock", "delivery-photo", {
      name: "front.jpg",
      bytes: jpegWithGps(),
    });
    expect(result.ok).toBe(true);
    expect(sy.queued).toHaveLength(0);
    const rows = service.filesFor(KEY, "March stock");
    expect(rows[0]).toMatchObject({
      state: "refused",
      reason: "Only a driver can attach a delivery photo.",
    });
    expect(await pending.read(rows[0]!.hash)).toBeUndefined();
  });

  it("refuses a file too big or of the wrong kind before anything is sent", async () => {
    const { net, sy, service } = setup();
    await service.start();
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set([0xff, 0xd8, 0xff]);
    expect(
      await service.attach(KEY, "March stock", "delivery-photo", { name: "big.jpg", bytes: big }),
    ).toEqual({
      ok: false,
      reason: "That file is too big (limit 5 MB).",
    });
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    expect(
      await service.attach(KEY, "March stock", "price-list", { name: "x.zip", bytes: zip }),
    ).toEqual({
      ok: false,
      reason: "That kind of file isn't accepted.",
    });
    expect(net.log).toEqual([]);
    expect(sy.queued).toHaveLength(0);
  });

  it("refuses a phone number in the order name before anything is sent", async () => {
    const { net, service } = setup();
    await service.start();
    const result = await service.attach("a".repeat(64), "call 082 555 1234", "delivery-photo", {
      name: "front.jpg",
      bytes: jpegWithGps(),
    });
    expect(result).toEqual({
      ok: false,
      reason: "Personal details can't be written to the shared record.",
    });
    expect(net.log).toEqual([]);
  });

  it("keeps a file name as a label, never a path", () => {
    expect(labelOf("../../etc/passwd", "price-list")).toBe("passwd");
    expect(labelOf("C:\\Users\\me\\IMG 0234.jpg", "delivery-photo")).toBe("IMG 0234.jpg");
    expect(labelOf("\n\t", "delivery-photo")).toBe("Photo");
    expect(labelOf("x".repeat(300), "price-list")).toHaveLength(120);
  });
});

describe("checking a file the Node holds", () => {
  it("verifies fetched bytes against the recorded hash, and caches only a match", async () => {
    const { net, cache, service } = setup();
    await service.start();
    const bytes = jpegWithGps();
    const checked = checkFileBytes(bytes, "delivery-photo");
    if (!checked.ok) throw new Error("fixture");
    const hash = Array.from(sha512(checked.stored), (b) => b.toString(16).padStart(2, "0")).join(
      "",
    );
    net.tamper(hash, checked.stored);
    expect(await service.check(KEY, hash)).toBe("verified");
    expect(await cache.read(cacheNameOf(KEY, hash))).toBeDefined();
  });

  it("shows a changed file as not matching, and does not cache it", async () => {
    const { net, cache, service } = setup();
    await service.start();
    const bytes = jpegWithGps();
    const checked = checkFileBytes(bytes, "delivery-photo");
    if (!checked.ok) throw new Error("fixture");
    const hash = Array.from(sha512(checked.stored), (b) => b.toString(16).padStart(2, "0")).join(
      "",
    );
    const changed = new Uint8Array(checked.stored);
    changed[changed.length - 3]! ^= 0xff;
    net.tamper(hash, changed);
    expect(await service.check(KEY, hash)).toBe("does_not_match");
    expect(await cache.read(cacheNameOf(KEY, hash))).toBeUndefined();
  });

  it("a cached copy that is deleted is fetched again when the file is opened", async () => {
    const { net, cache, service } = setup();
    await service.start();
    const bytes = jpegWithGps();
    const checked = checkFileBytes(bytes, "delivery-photo");
    if (!checked.ok) throw new Error("fixture");
    const hash = Array.from(sha512(checked.stored), (b) => b.toString(16).padStart(2, "0")).join(
      "",
    );
    net.tamper(hash, checked.stored);
    expect(await service.check(KEY, hash)).toBe("verified");
    await service.forgetCommunity(KEY);
    expect(await cache.read(cacheNameOf(KEY, hash))).toBeUndefined();
    expect(await service.check(KEY, hash)).toBe("verified");
    expect(await cache.read(cacheNameOf(KEY, hash))).toBeDefined();
  });
});

// ---- review patch: names, one photo on two orders, the cache by community, the Node's empty reply, the picker copy ----

describe("review patch: what reaches the record and the phone", () => {
  it("the record carries a generated label, never the person's file name", async () => {
    const { sy, service } = setup();
    await service.start();
    await service.attach(KEY, "March stock", "delivery-photo", {
      name: "14 Kgosi Street gate.jpg",
      bytes: jpegWithGps(),
    });
    const event = sy.queued[0]!.event;
    const payload = event.payload as { name: string };
    expect(payload.name).toMatch(/^Delivery photo [0-9a-f]{8}$/);
    expect(JSON.stringify(event)).not.toContain("Kgosi");
    expect(JSON.stringify(event)).not.toContain("gate");
  });

  it("the same photo attached to two orders while offline sends both events (7)", async () => {
    const { net, sy, service } = setup({ offline: true });
    await service.start();
    await service.attach(KEY, "Order A", "delivery-photo", {
      name: "front.jpg",
      bytes: jpegWithGps(),
    });
    await service.attach(KEY, "Order B", "delivery-photo", {
      name: "front.jpg",
      bytes: jpegWithGps(),
    });
    expect(service.filesFor(KEY, "Order A").map((r) => r.state)).toEqual(["waiting"]);
    expect(service.filesFor(KEY, "Order B").map((r) => r.state)).toEqual(["waiting"]);
    net.setOnline(true);
    await service.retryPending();
    expect(sy.queued.map((q) => (q.event.payload as { order: string }).order).sort()).toEqual([
      "Order A",
      "Order B",
    ]);
    expect(service.filesFor(KEY, "Order A").map((r) => r.state)).toEqual(["saved"]);
    expect(service.filesFor(KEY, "Order B").map((r) => r.state)).toEqual(["saved"]);
  });

  it("a Node reply with no bytes reads as the Node failing, not as a mismatch (14)", async () => {
    const { service } = setup({ emptyRead: true });
    await service.start();
    expect(await service.check(KEY, "b".repeat(128))).toBe("unavailable");
  });

  it("keeps the cached copy per community: another community's view fetches again", async () => {
    const { net, service } = setup();
    await service.start();
    const bytes = jpegWithGps();
    const checked = checkFileBytes(bytes, "delivery-photo");
    if (!checked.ok) throw new Error("fixture");
    const hash = Array.from(sha512(checked.stored), (b) => b.toString(16).padStart(2, "0")).join(
      "",
    );
    net.tamper(hash, checked.stored);
    expect(await service.check(KEY, hash)).toBe("verified");
    const reads = net.log.filter((l) => l === "read").length;
    expect(await service.check("b".repeat(64), hash)).toBe("verified");
    expect(net.log.filter((l) => l === "read").length).toBe(reads + 1);
  });

  it("evicts the least recently used copy above the cap, and fetches it again when opened", async () => {
    const { net, service } = setup({ cacheCapBytes: 15 });
    await service.start();
    const make = (tag: number) => {
      const b = new Uint8Array(jpegWithGps());
      b[b.length - 3] = tag;
      const c = checkFileBytes(b, "delivery-photo");
      if (!c.ok) throw new Error("fixture");
      return {
        hash: Array.from(sha512(c.stored), (x) => x.toString(16).padStart(2, "0")).join(""),
        stored: c.stored,
      };
    };
    const first = make(1);
    const second = make(2);
    net.tamper(first.hash, first.stored);
    net.tamper(second.hash, second.stored);
    expect(await service.check(KEY, first.hash)).toBe("verified");
    expect(await service.check(KEY, second.hash)).toBe("verified");
    const before = net.log.filter((l) => l === "read").length;
    expect(await service.check(KEY, first.hash)).toBe("verified");
    expect(net.log.filter((l) => l === "read").length).toBe(before + 1);
  });

  it("forgets a community's cached copies when the phone leaves it", async () => {
    const { net, service } = setup();
    await service.start();
    const checked = checkFileBytes(jpegWithGps(), "delivery-photo");
    if (!checked.ok) throw new Error("fixture");
    const hash = Array.from(sha512(checked.stored), (b) => b.toString(16).padStart(2, "0")).join(
      "",
    );
    net.tamper(hash, checked.stored);
    expect(await service.check(KEY, hash)).toBe("verified");
    await service.forgetCommunity(KEY);
    const before = net.log.filter((l) => l === "read").length;
    expect(await service.check(KEY, hash)).toBe("verified");
    expect(net.log.filter((l) => l === "read").length).toBe(before + 1);
  });

  it("calls the picked file's discard once its bytes are on the Node, so the picker's copy is removed (10)", async () => {
    const { service } = setup();
    await service.start();
    let discarded = 0;
    await service.attach(KEY, "March stock", "delivery-photo", {
      name: "front.jpg",
      bytes: jpegWithGps(),
      discard: async () => {
        discarded += 1;
      },
    });
    expect(discarded).toBe(1);
  });
});
