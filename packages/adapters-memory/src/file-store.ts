import {
  err,
  ok,
  type FileRange,
  type FileStore,
  type Result,
  type PortError,
  type Sha512Hex,
} from "@shopong/ports";

/** In-memory `FileStore`: bytes in a map, keyed by hash. For tests and the scripted tracer. */
export class MemoryFileStore implements FileStore {
  readonly #files = new Map<string, Uint8Array>();

  async put(sha512: Sha512Hex, bytes: Uint8Array) {
    if (this.#files.has(sha512)) return ok({ duplicate: true });
    this.#files.set(sha512, new Uint8Array(bytes));
    return ok({ duplicate: false });
  }

  async has(sha512: Sha512Hex): Promise<boolean> {
    return this.#files.has(sha512);
  }

  async sizeOf(sha512: Sha512Hex): Promise<number | undefined> {
    return this.#files.get(sha512)?.length;
  }

  async bytesHeld(): Promise<number> {
    let total = 0;
    for (const bytes of this.#files.values()) total += bytes.length;
    return total;
  }

  async get(
    sha512: Sha512Hex,
    range?: FileRange,
  ): Promise<Result<Uint8Array, PortError<"not_found" | "read_failed" | "bad_range">>> {
    const bytes = this.#files.get(sha512);
    if (bytes === undefined) return err("not_found", "This file is not held.");
    if (range === undefined) return ok(new Uint8Array(bytes));
    if (!(range.start >= 0 && range.end >= range.start && range.end < bytes.length)) {
      return err("bad_range", "That part of the file is not there.");
    }
    return ok(bytes.slice(range.start, range.end + 1));
  }

  async close(): Promise<void> {
    this.#files.clear();
  }
}
