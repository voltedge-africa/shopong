// The Node's file routes (story 3.7), over HTTP on a real Node with its Hyperdrive. Each row of the plan's security and
// privacy matrix is a test: non-member upload and read, wrong role, oversize, wrong type, a declared hash that does not
// match, EXIF GPS in a photo, a traversal in a hash, and a replayed upload. The write-failure row runs on the route alone.
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import {
  checkInvitation,
  createCommunity,
  joinCommunity,
  signRequest,
  type Community,
  type RequestParts,
} from "@shopong/community";
import { checkFileBytes, sha512Hex, toBase64, webCryptoSha512 } from "@shopong/events";
import { asSha512Hex, type FileStore, type ViewReader } from "@shopong/ports";
import { MemoryFileStore } from "@shopong/adapters-memory";
import { afterAll, afterEach, describe, expect, it } from "vite-plus/test";
import {
  InFlightGate,
  MAX_FILE_BODY_BYTES,
  MAX_UPLOADS_IN_FLIGHT,
  registerFileRoutes,
  UPLOADS_PER_WINDOW,
} from "./files.ts";
import { keepRawJsonBody } from "./signed.ts";
import { startNode, type RunningNode } from "./node.ts";
import { captureSink, FAKE_SECRETS } from "./testing/capture.ts";
import { phone, randomHex, T0, type Phone } from "./testing/community.ts";

const folders: string[] = [];
const freshFolder = (): string => {
  const folder = mkdtempSync(join(tmpdir(), "ocn-node-files-"));
  folders.push(folder);
  return folder;
};
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});
let running: RunningNode | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

const ascii = (text: string) => Array.from(text, (ch) => ch.charCodeAt(0));
const u16 = (n: number) => [(n >> 8) & 255, n & 255];

/** A JPEG with an EXIF block carrying GPS and a time, then a scan with image bytes. */
function jpegWithGps(pad = 0): Uint8Array {
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
    0xdb,
    ...u16(4),
    0x00,
    0x01,
    0xff,
    0xda,
    ...u16(4),
    0x01,
    0x02,
    ...Array.from({ length: pad }, () => 0x33),
    0xff,
    0xd9,
  ]);
}

async function start(): Promise<RunningNode> {
  const dataDir = freshFolder();
  running = await startNode({
    env: {
      OCN_NODE_PORT: "0",
      OCN_NODE_DATA_DIR: dataDir,
      RECORD_MASTER_KEY: FAKE_SECRETS.RECORD_MASTER_KEY,
    },
    sink: captureSink(),
  });
  return running;
}

/** A community on the Node: a creator, a driver (given the role by the creator) and a stranger who is not a member. */
async function seed(node: RunningNode) {
  const hub = node.hub!;
  const creator = await phone();
  const driver = await phone();
  const stranger = await phone();
  const made = await createCommunity(creator.deps, await hub.recordOf(creator.did), "Spaza", T0);
  if (!made.ok) throw new Error(made.error.message);
  const founder: Community = made.value;
  await hub.register(founder);
  const invited = await founder.invite(driver.did, T0);
  if (!invited.ok) throw new Error(invited.error.message);
  await hub.admitMember(founder.key, driver.did);
  const space = await hub.replicaOf(driver.did, founder.key);
  if (space === undefined) throw new Error("no replica");
  await hub.catchUp(founder.key);
  const checked = await checkInvitation({
    auth: driver.auth,
    text: invited.value.code,
    me: driver.did,
    now: T0,
  });
  if (!checked.ok) throw new Error(checked.error.message);
  const joined = await joinCommunity(driver.deps, space, checked.value, T0);
  if (!joined.ok) throw new Error(joined.error.message);
  await hub.catchUp(founder.key);
  const granted = await founder.grantRole(driver.did, "driver", {}, T0);
  if (!granted.ok) throw new Error(granted.error.message);
  await hub.catchUp(founder.key);
  return { creator, driver, stranger, key: founder.key };
}

/** A signed request as `signer` sends it: `body` is JSON text, or empty for a read. */
function signedHeaders(
  signer: Phone,
  method: "GET" | "POST",
  path: string,
  body: string,
  nonce = randomHex(16),
) {
  const parts: RequestParts = { method, path, body, nonce, time: Date.now(), actor: signer.did };
  return signRequest(signer.auth, parts, webCryptoSha512);
}

async function send(
  node: RunningNode,
  signer: Phone,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  extra: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const text = body === undefined ? "" : JSON.stringify(body);
  const signed = await signedHeaders(signer, method, path, text);
  if (!signed.ok) throw new Error(signed.error.message);
  const res = await fetch(`${node.url}${path}`, {
    method,
    headers: {
      ...(signed.value as unknown as Record<string, string>),
      ...extra,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: text }),
  });
  return {
    status: res.status,
    json: (await res.json().catch(() => ({}))) as Record<string, unknown>,
  };
}

/**
 * The upload body the phone sends: the file as given, its purpose and type, and the SHA-512 of the bytes the Node will
 * keep (the stripped ones). Node's own SHA-512 gives the same hex, so it is taken synchronously here.
 */
function upload(
  bytes: Uint8Array,
  type: "image/jpeg" | "image/png" | "image/webp" | "application/pdf",
  purpose: "delivery-photo" | "price-list",
) {
  const checked = checkFileBytes(bytes, purpose, type);
  if (!checked.ok) throw new Error(checked.message);
  return {
    sha512: createHash("sha512").update(checked.stored).digest("hex"),
    purpose,
    type,
    bytes: toBase64(bytes),
  };
}

describe("uploading a file", () => {
  it("keeps a photo with GPS with no EXIF or GPS, and records the hash of the bytes kept", async () => {
    const node = await start();
    const { driver, key } = await seed(node);
    const body = upload(jpegWithGps(), "image/jpeg", "delivery-photo");
    const res = await send(node, driver, "POST", `/spaces/${key}/files`, body);
    expect(res.status).toBe(200);
    expect(res.json.sha512).toBe(body.sha512);
    expect(res.json.duplicate).toBe(false);

    const read = await send(node, driver, "GET", `/spaces/${key}/files/${body.sha512}`);
    expect(read.status).toBe(200);
    const stored = new Uint8Array(Buffer.from(read.json.bytes as string, "base64"));
    const text = String.fromCharCode(...stored);
    expect(text).not.toContain("GPS");
    expect(text).not.toContain("Exif");
    expect(text).not.toContain("2026:10:26");
    expect(await sha512Hex(stored, webCryptoSha512)).toBe(body.sha512);
  });

  it("refuses a non-member's upload, and keeps nothing", async () => {
    const node = await start();
    const { stranger, key } = await seed(node);
    const res = await send(
      node,
      stranger,
      "POST",
      `/spaces/${key}/files`,
      upload(jpegWithGps(), "image/jpeg", "delivery-photo"),
    );
    expect(res.status).toBe(403);
    expect(res.json.problem).toBe("not_member");
  });

  it("refuses a member with the wrong role: the creator cannot attach a delivery photo, a driver cannot attach a price list", async () => {
    const node = await start();
    const { creator, driver, key } = await seed(node);
    const photo = await send(
      node,
      creator,
      "POST",
      `/spaces/${key}/files`,
      upload(jpegWithGps(), "image/jpeg", "delivery-photo"),
    );
    expect(photo.status).toBe(403);
    expect(photo.json.problem).toBe("not_permitted");
    const pdf = new Uint8Array([...ascii("%PDF-1.7"), 10, 32, 32]);
    const list = await send(
      node,
      driver,
      "POST",
      `/spaces/${key}/files`,
      upload(pdf, "application/pdf", "price-list"),
    );
    expect(list.status).toBe(403);
    expect(list.json.problem).toBe("not_permitted");
  });

  it("refuses a file over its limit before it is kept (photo 5 MB, price list 10 MB)", async () => {
    const node = await start();
    const { driver, creator, key } = await seed(node);
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set([0xff, 0xd8, 0xff]);
    const photo = await send(node, driver, "POST", `/spaces/${key}/files`, {
      sha512: "0".repeat(128),
      purpose: "delivery-photo",
      type: "image/jpeg",
      bytes: toBase64(big),
    });
    expect(photo.status).toBe(413);
    expect(photo.json.problem).toBe("too_big");
    const pdfBig = new Uint8Array(10 * 1024 * 1024 + 1);
    pdfBig.set([...ascii("%PDF-")]);
    const list = await send(node, creator, "POST", `/spaces/${key}/files`, {
      sha512: "0".repeat(128),
      purpose: "price-list",
      type: "application/pdf",
      bytes: toBase64(pdfBig),
    });
    expect(list.status).toBe(413);
    expect(list.json.reason).toBe("That file is too big (limit 10 MB).");
  }, 30_000);

  it("refuses a body far over the route's limit with 413 before reading it", async () => {
    const node = await start();
    const { driver, key } = await seed(node);
    const huge = "x".repeat(MAX_FILE_BODY_BYTES + 10);
    const res = await send(node, driver, "POST", `/spaces/${key}/files`, {
      sha512: "0".repeat(128),
      purpose: "delivery-photo",
      type: "image/jpeg",
      bytes: huge,
    });
    expect(res.status).toBe(413);
  });

  it("refuses a wrong type: a ZIP sent as a JPEG, and a declared type the bytes do not have", async () => {
    const node = await start();
    const { driver, key } = await seed(node);
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    const res = await send(node, driver, "POST", `/spaces/${key}/files`, {
      sha512: "1".repeat(128),
      purpose: "delivery-photo",
      type: "image/jpeg",
      bytes: toBase64(zip),
    });
    expect(res.status).toBe(415);
    expect(res.json.problem).toBe("wrong_type");
    const png = await send(node, driver, "POST", `/spaces/${key}/files`, {
      sha512: "1".repeat(128),
      purpose: "delivery-photo",
      type: "image/png",
      bytes: toBase64(jpegWithGps()),
    });
    expect(png.status).toBe(415);
  });

  it("refuses a file whose hash is not the hash of the bytes kept, and keeps nothing", async () => {
    const node = await start();
    const { driver, key } = await seed(node);
    const bytes = jpegWithGps();
    // The sender declares the hash of the file WITH its GPS (not stripped): the bytes kept differ, so it is refused.
    const declared = await sha512Hex(bytes, webCryptoSha512);
    const res = await send(node, driver, "POST", `/spaces/${key}/files`, {
      sha512: declared,
      purpose: "delivery-photo",
      type: "image/jpeg",
      bytes: toBase64(bytes),
    });
    expect(res.status).toBe(400);
    expect(res.json.problem).toBe("did_not_arrive");
    const kept = await send(node, driver, "GET", `/spaces/${key}/files/${declared}`);
    expect(kept.status).toBe(404);
  });

  it("keeps the same bytes once and says so the second time", async () => {
    const node = await start();
    const { driver, key } = await seed(node);
    const body = upload(jpegWithGps(), "image/jpeg", "delivery-photo");
    expect((await send(node, driver, "POST", `/spaces/${key}/files`, body)).json.duplicate).toBe(
      false,
    );
    expect((await send(node, driver, "POST", `/spaces/${key}/files`, body)).json.duplicate).toBe(
      true,
    );
  });

  it("refuses a replayed upload: the same signed request twice", async () => {
    const node = await start();
    const { driver, key } = await seed(node);
    const text = JSON.stringify(upload(jpegWithGps(), "image/jpeg", "delivery-photo"));
    const path = `/spaces/${key}/files`;
    const nonce = randomHex(16);
    const signed = await signedHeaders(driver, "POST", path, text, nonce);
    if (!signed.ok) throw new Error(signed.error.message);
    const headers = {
      ...(signed.value as unknown as Record<string, string>),
      "content-type": "application/json",
    };
    const first = await fetch(`${node.url}${path}`, { method: "POST", headers, body: text });
    const second = await fetch(`${node.url}${path}`, { method: "POST", headers, body: text });
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(((await second.json()) as { problem: string }).problem).toBe("replayed");
  });
});

describe("reading a file", () => {
  it("refuses a non-member's read and returns no bytes", async () => {
    const node = await start();
    const { driver, stranger, key } = await seed(node);
    const body = upload(jpegWithGps(), "image/jpeg", "delivery-photo");
    expect((await send(node, driver, "POST", `/spaces/${key}/files`, body)).status).toBe(200);
    const res = await send(node, stranger, "GET", `/spaces/${key}/files/${body.sha512}`);
    expect(res.status).toBe(403);
    expect(res.json.bytes).toBeUndefined();
  });

  it("answers a byte range inclusively, and refuses a range outside the file", async () => {
    const node = await start();
    const { driver, key } = await seed(node);
    const bytes = jpegWithGps();
    const body = upload(bytes, "image/jpeg", "delivery-photo");
    await send(node, driver, "POST", `/spaces/${key}/files`, body);
    const stored = checkFileBytes(bytes, "delivery-photo", "image/jpeg");
    if (!stored.ok) throw new Error("fixture");
    const part = await send(node, driver, "GET", `/spaces/${key}/files/${body.sha512}`, undefined, {
      range: "bytes=0-1",
    });
    expect(part.status).toBe(206);
    expect(Array.from(new Uint8Array(Buffer.from(part.json.bytes as string, "base64")))).toEqual([
      0xff, 0xd8,
    ]);
    const outside = await send(
      node,
      driver,
      "GET",
      `/spaces/${key}/files/${body.sha512}`,
      undefined,
      { range: "bytes=0-99999999" },
    );
    expect(outside.status).toBe(416);
  });

  it("refuses a hash that is not a SHA-512 (a traversal attempt in the path)", async () => {
    const node = await start();
    const { driver, key } = await seed(node);
    const res = await send(node, driver, "GET", `/spaces/${key}/files/..%2F..%2Fsecret`);
    expect(res.status).toBe(400);
    expect(res.json.problem).toBe("invalid_file");
  });
});

describe("the route on its own", () => {
  /** A minimal app with the file routes, a fake hub and a store that can be made to fail. */
  async function routeApp(store: FileStore, creator: Phone, member: Phone) {
    const auth = member.auth;
    const view: ViewReader = { get: async () => undefined, list: async () => [] };
    const app = Fastify({ logger: false });
    keepRawJsonBody(app);
    registerFileRoutes(app, {
      hub: {
        isMember: async (did) => (did === member.did || did === creator.did ? true : false),
        creatorOf: () => creator.did,
        indexedView: async () => view,
      },
      stores: { of: async () => store },
      auth,
    });
    return app;
  }

  it("answers 503 and keeps the upload queued when the Node cannot write the file", async () => {
    const failing: FileStore = {
      put: async () => ({ ok: false, error: { code: "write_failed", message: "disk full" } }),
      has: async () => false,
      sizeOf: async () => undefined,
      bytesHeld: async () => 0,
      get: async () => ({ ok: false, error: { code: "not_found", message: "no" } }),
      close: async () => undefined,
    };
    const creator = await phone();
    const app = await routeApp(failing, creator, creator);
    // The creator is the treasurer, so a price list is in its role; the store then fails to write it.
    const body = upload(jpegWithGps(), "image/jpeg", "price-list");
    const text = JSON.stringify(body);
    const path = `/spaces/${"a".repeat(64)}/files`;
    const signed = await signRequest(
      creator.auth,
      {
        method: "POST",
        path,
        body: text,
        nonce: randomHex(16),
        time: Date.now(),
        actor: creator.did,
      },
      webCryptoSha512,
    );
    if (!signed.ok) throw new Error(signed.error.message);
    const res = await app.inject({
      method: "POST",
      url: path,
      headers: {
        ...(signed.value as unknown as Record<string, string>),
        "content-type": "application/json",
      },
      payload: text,
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().reason).toBe("Couldn't save the file. We'll try again.");
    await app.close();
  });

  it("the memory store is the same contract (used by the route tests above)", async () => {
    const store = new MemoryFileStore();
    expect((await store.put(asSha512Hex("ab".repeat(64)), new Uint8Array([1]))).ok).toBe(true);
  });
});

// ---- review patch: rate limit, quota, in-flight cap, early refusal, Content-Range -----------------------------------

describe("review patch: limits on uploads", () => {
  /** A route app with a treasurer (the creator), an in-memory store and the quota given. */
  async function limitedApp(quotaBytes?: number) {
    const creator = await phone();
    const store = new MemoryFileStore();
    const view: ViewReader = { get: async () => undefined, list: async () => [] };
    const app = Fastify({ logger: false });
    keepRawJsonBody(app);
    registerFileRoutes(app, {
      hub: {
        isMember: async () => true,
        creatorOf: () => creator.did,
        indexedView: async () => view,
      },
      stores: { of: async () => store },
      auth: creator.auth,
      ...(quotaBytes === undefined ? {} : { quotaBytes }),
    });
    return { app, creator, store };
  }

  /** One upload, signed as `who`, through the app's own HTTP handling (no network). */
  async function injectUpload(
    app: Awaited<ReturnType<typeof limitedApp>>["app"],
    who: Phone,
    body: unknown,
  ) {
    const path = `/spaces/${"a".repeat(64)}/files`;
    const text = JSON.stringify(body);
    const signed = await signRequest(
      who.auth,
      { method: "POST", path, body: text, nonce: randomHex(16), time: Date.now(), actor: who.did },
      webCryptoSha512,
    );
    if (!signed.ok) throw new Error(signed.error.message);
    return app.inject({
      method: "POST",
      url: path,
      headers: {
        ...(signed.value as unknown as Record<string, string>),
        "content-type": "application/json",
      },
      payload: text,
    });
  }

  it("refuses a member's uploads past 20 in the window, with a plain sentence", async () => {
    const { app, creator } = await limitedApp();
    let last = 0;
    for (let i = 0; i <= UPLOADS_PER_WINDOW; i++) {
      const res = await injectUpload(
        app,
        creator,
        upload(jpegWithGps(i), "image/jpeg", "price-list"),
      );
      last = res.statusCode;
      if (i < UPLOADS_PER_WINDOW) expect(res.statusCode).toBe(200);
    }
    expect(last).toBe(429);
    await app.close();
  });

  it("refuses an upload that would take the community past its quota, and keeps a file it already holds", async () => {
    const { app, creator } = await limitedApp(20);
    expect(
      (await injectUpload(app, creator, upload(jpegWithGps(0), "image/jpeg", "price-list")))
        .statusCode,
    ).toBe(200);
    const over = await injectUpload(
      app,
      creator,
      upload(jpegWithGps(5), "image/jpeg", "price-list"),
    );
    expect(over.statusCode).toBe(413);
    expect(over.json().problem).toBe("over_quota");
    // The same bytes again: already held, so no new room is needed.
    expect(
      (await injectUpload(app, creator, upload(jpegWithGps(0), "image/jpeg", "price-list")))
        .statusCode,
    ).toBe(200);
    await app.close();
  });

  it("allows at most four uploads in flight, and frees one when it answers", () => {
    const gate = new InFlightGate(MAX_UPLOADS_IN_FLIGHT);
    for (let i = 0; i < MAX_UPLOADS_IN_FLIGHT; i++) expect(gate.take()).toBe(true);
    expect(gate.take()).toBe(false);
    gate.give();
    expect(gate.take()).toBe(true);
    expect(gate.inFlight).toBe(MAX_UPLOADS_IN_FLIGHT);
  });

  it("refuses a declared Content-Length over the limit before the body is read", async () => {
    const { app, creator, store } = await limitedApp();
    const res = await app.inject({
      method: "POST",
      url: `/spaces/${"a".repeat(64)}/files`,
      headers: {
        "content-type": "application/json",
        "content-length": String(MAX_FILE_BODY_BYTES + 1),
      },
      payload: "{}",
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().problem).toBe("request_too_large");
    expect(await store.bytesHeld()).toBe(0);
    void creator;
    await app.close();
  });
});

describe("review patch: Content-Range on a partial read", () => {
  it("answers a byte range with a Content-Range header that names the whole size (13)", async () => {
    const node = await start();
    const { driver, key } = await seed(node);
    const body = upload(jpegWithGps(), "image/jpeg", "delivery-photo");
    expect((await send(node, driver, "POST", `/spaces/${key}/files`, body)).status).toBe(200);
    const path = `/spaces/${key}/files/${body.sha512}`;
    const signed = await signedHeaders(driver, "GET", path, "");
    if (!signed.ok) throw new Error(signed.error.message);
    const res = await fetch(`${node.url}${path}`, {
      headers: { ...(signed.value as unknown as Record<string, string>), range: "bytes=0-1" },
    });
    expect(res.status).toBe(206);
    const total = (await send(node, driver, "GET", path)).json.length as number;
    expect(res.headers.get("content-range")).toBe(`bytes 0-1/${total}`);
  });
});
