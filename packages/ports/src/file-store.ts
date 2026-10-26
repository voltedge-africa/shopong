import type { PortError, Result, Sha512Hex } from "./common.js";

/** An inclusive byte range: `end` is the last byte wanted, so `{ start: 0, end: 0 }` is one byte. */
export interface FileRange {
  readonly start: number;
  readonly end: number;
}

export type FileStorePutCode = "write_failed";
export type FileStoreGetCode = "not_found" | "read_failed" | "bad_range";

/**
 * Bytes kept beside one community's record, each under its SHA-512 (story 3.7). The store does not decide what a
 * file may be: the Node checks size, type, stripped metadata and the declared hash before it calls `put`. Storing
 * the same hash again keeps one copy and says so. Owning story: 3.7. Adapters: Hyperdrive on the Node.
 */
export interface FileStore {
  /** Stores `bytes` under `sha512`. `duplicate` is true when that hash was already held (nothing is written again). */
  put(
    sha512: Sha512Hex,
    bytes: Uint8Array,
  ): Promise<Result<{ readonly duplicate: boolean }, PortError<FileStorePutCode>>>;
  /** Whether the hash is held. */
  has(sha512: Sha512Hex): Promise<boolean>;
  /** The size in bytes of a held file, or undefined when the hash is not held. */
  sizeOf(sha512: Sha512Hex): Promise<number | undefined>;
  /** The total bytes held in this store (the quota is checked against it). */
  bytesHeld(): Promise<number>;
  /** The whole file, or only `range` of it. A missing hash is `not_found`; a range outside the file is `bad_range`. */
  get(
    sha512: Sha512Hex,
    range?: FileRange,
  ): Promise<Result<Uint8Array, PortError<FileStoreGetCode>>>;
  /** Releases the store's files. The store is unusable afterwards. */
  close(): Promise<void>;
}
