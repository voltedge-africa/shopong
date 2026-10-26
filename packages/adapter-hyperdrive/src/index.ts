// The Hyperdrive adapter of the FileStore port (story 3.7). The OCN Node keeps each community's files in one
// Hyperdrive, opened on a namespace of its own Corestore beside the community's record. Bytes go in under their
// SHA-512 hex (`/<hash>`), so a file's name is its content hash and nothing else (no personal data, no user name).
//
// The Corestore's primary key is derived from the Node's master key, as the record's is (record-autobase keys.ts),
// under its own label, so a file store never shares a key with the record. Like the record's store, the primary key
// is kept as plain text in the data folder (AD-18): see the shortcut register (S-3.7-6).
//
// Hyperdrive ships no type declarations, so it is loaded through CommonJS and typed here for the calls it makes.

import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  err,
  ok,
  type FileRange,
  type FileStore,
  type Result,
  type PortError,
  type Sha512Hex,
} from "@shopong/ports";

const requireCjs = createRequire(import.meta.url);
/** The part of a Corestore this package uses. */
interface CorestoreLike {
  namespace(name: string): unknown;
  ready(): Promise<void>;
  close(): Promise<void>;
}
const Corestore = requireCjs("corestore") as new (
  dir: string,
  options: Record<string, unknown>,
) => CorestoreLike;
const Hyperdrive = requireCjs("hyperdrive") as new (store: unknown) => HyperdriveLike;

interface HyperdriveLike {
  ready(): Promise<void>;
  close(): Promise<void>;
  put(name: string, buf: Buffer): Promise<unknown>;
  exists(name: string): Promise<boolean>;
  entry(name: string): Promise<{ value: { blob?: { byteLength: number } } } | null>;
  list(folder: string): AsyncIterable<{ value: { blob?: { byteLength: number } } }>;
  createReadStream(name: string, options?: { start?: number; end?: number }): AsyncIterable<Buffer>;
}

/** The label that keeps the file store's key apart from the record's. */
export const FILES_LABEL = "ocn/files/v1/corestore";

/** The Corestore primary key of the files, derived from the Node's master key (32 bytes). */
export function filesPrimaryKey(masterKey: Uint8Array): Buffer {
  return createHmac("sha512", masterKey).update(FILES_LABEL, "utf8").digest().subarray(0, 32);
}

const pathOf = (sha512: string) => `/${sha512}`;

/** The FileStore of one community, on one Hyperdrive. */
class HyperdriveFileStore implements FileStore {
  readonly #drive: HyperdriveLike;

  constructor(drive: HyperdriveLike) {
    this.#drive = drive;
  }

  async put(
    sha512: Sha512Hex,
    bytes: Uint8Array,
  ): Promise<Result<{ readonly duplicate: boolean }, PortError<"write_failed">>> {
    if (await this.#drive.exists(pathOf(sha512))) return ok({ duplicate: true });
    try {
      await this.#drive.put(pathOf(sha512), Buffer.from(bytes));
    } catch {
      return err("write_failed", "Couldn't save the file. We'll try again.");
    }
    return ok({ duplicate: false });
  }

  async has(sha512: Sha512Hex): Promise<boolean> {
    return this.#drive.exists(pathOf(sha512));
  }

  async sizeOf(sha512: Sha512Hex): Promise<number | undefined> {
    const node = await this.#drive.entry(pathOf(sha512)).catch(() => null);
    return node?.value.blob?.byteLength;
  }

  async bytesHeld(): Promise<number> {
    let total = 0;
    for await (const entry of this.#drive.list("/")) total += entry.value.blob?.byteLength ?? 0;
    return total;
  }

  async get(
    sha512: Sha512Hex,
    range?: FileRange,
  ): Promise<Result<Uint8Array, PortError<"not_found" | "read_failed" | "bad_range">>> {
    const path = pathOf(sha512);
    const node = await this.#drive.entry(path).catch(() => null);
    if (node === null || node.value.blob === undefined) {
      return err("not_found", "This file is not held.");
    }
    const size = node.value.blob.byteLength;
    const start = range?.start ?? 0;
    const end = range?.end ?? size - 1;
    if (!(start >= 0 && end >= start && end < size)) {
      return err("bad_range", "That part of the file is not there.");
    }
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of this.#drive.createReadStream(path, { start, end })) {
        chunks.push(chunk);
      }
      return ok(new Uint8Array(Buffer.concat(chunks)));
    } catch {
      return err("read_failed", "The file could not be read.");
    }
  }

  async close(): Promise<void> {
    await this.#drive.close();
  }
}

export interface HyperdriveFilesOptions {
  /** The folder the files' Corestore lives in. Created when missing. */
  readonly dataDir: string;
  /** The Node's 32-byte master key. Only the Node holds it. */
  readonly masterKey: Uint8Array;
  /** Test seam: how the Corestore is made. Defaults to the Corestore package. */
  readonly openCorestore?: (dir: string, options: Record<string, unknown>) => CorestoreLike;
}

/**
 * One Corestore for the Node's files and one Hyperdrive per community, opened on demand and kept until `close`. The
 * Corestore itself is opened on first use, so a Node that never touches a file holds no file lock. `of` answers the same
 * store for the same community every time.
 */
export class HyperdriveFileStores {
  readonly #options: HyperdriveFilesOptions;
  #store: Promise<CorestoreLike> | undefined;
  readonly #drives = new Map<string, Promise<HyperdriveFileStore>>();

  private constructor(options: HyperdriveFilesOptions) {
    this.#options = options;
  }

  static async open(options: HyperdriveFilesOptions): Promise<HyperdriveFileStores> {
    return new HyperdriveFileStores(options);
  }

  #corestore(): Promise<CorestoreLike> {
    if (this.#store === undefined) {
      const dir = join(this.#options.dataDir, "files");
      this.#store = (async () => {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        const make = this.#options.openCorestore ?? ((d, o) => new Corestore(d, o));
        const store = make(dir, {
          primaryKey: filesPrimaryKey(this.#options.masterKey),
          unsafe: true,
        });
        await store.ready();
        return store;
      })();
      // A failed open is forgotten, so the next call tries again instead of failing until a restart (review item 9).
      this.#store.catch(() => {
        this.#store = undefined;
      });
    }
    return this.#store;
  }

  /** The community's file store. The first call opens its drive; a failed open is forgotten so it can be tried again. */
  of(communityKey: string): Promise<FileStore> {
    let drive = this.#drives.get(communityKey);
    if (drive === undefined) {
      drive = (async () => {
        const store = await this.#corestore();
        const d = new Hyperdrive(store.namespace(`community/${communityKey}`));
        await d.ready();
        return new HyperdriveFileStore(d);
      })();
      this.#drives.set(communityKey, drive);
      drive.catch(() => {
        if (this.#drives.get(communityKey) === drive) this.#drives.delete(communityKey);
      });
    }
    return drive;
  }

  async close(): Promise<void> {
    for (const pending of this.#drives.values()) await (await pending).close();
    this.#drives.clear();
    if (this.#store !== undefined) await (await this.#store).close();
    this.#store = undefined;
  }
}
