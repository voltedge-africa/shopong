// Read-only access to the release folder for the Node's routes.
//
// A release is checked in full (every listed file's SHA-512) before its first byte is served. What was checked is
// kept: the manifest's bytes and digest are held in memory, and each listed file is opened without following links,
// then compared with the stamp the check recorded (size, mtime, inode, device). A file that no longer matches is
// never served under its old tag: the release is checked again (hashed), and refused if the check fails. A failed
// check is remembered only for a retry interval, so a repaired release comes back without a restart.
import { constants as fsConstants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { contentTypeFor, isSafeRelativePath, isSafeReleaseName } from "./paths.js";
import { MANIFEST_FILE, type ReleaseFile, type ReleaseManifest } from "./manifest.js";
import { digestOf, verifyRelease, type FileStamp, type VerifyResult } from "./verify.js";

export type LookupFailure = "bad-name" | "bad-path" | "no-release" | "not-listed" | "unchecked";

/** A file the Node may answer with. Bytes are read only through `stream`, from what was checked. */
export interface ServedFile {
  readonly size: number;
  /** The SHA-512 of the file, the strong validator for its ETag. */
  readonly sha512: string;
  readonly contentType: string;
  /** Streams bytes `start` to `end`, both inclusive. Call exactly one of `stream` or `discard`. */
  stream(start: number, end: number): Readable;
  /** Gives up the file without sending it (a 304 or 416 answer). */
  discard(): void;
}

export interface StoreOptions {
  /** Clock in milliseconds. Injected by tests. */
  readonly now?: () => number;
  /** How long a failed check is kept before the release is checked again. Default 30 seconds. */
  readonly retryFailedAfterMs?: number;
}

type Checked = {
  readonly ok: true;
  readonly manifest: ReleaseManifest;
  readonly manifestBytes: Buffer;
  readonly digest: string;
  readonly stamps: ReadonlyMap<string, FileStamp>;
};
type Failed = {
  readonly ok: false;
  readonly missing: boolean;
  readonly problems: readonly string[];
};
type Outcome = Checked | Failed;

interface Entry {
  readonly promise: Promise<Outcome>;
  outcome?: Outcome;
  settledAt?: number;
}

export const DEFAULT_RETRY_MS = 30_000;

export class ReleaseStore {
  readonly releasesDir: string;
  private readonly entries = new Map<string, Entry>();
  private readonly now: () => number;
  private readonly retryMs: number;

  constructor(releasesDir: string, options: StoreOptions = {}) {
    this.releasesDir = releasesDir;
    this.now = options.now ?? Date.now;
    this.retryMs = options.retryFailedAfterMs ?? DEFAULT_RETRY_MS;
  }

  /** The current check of a release. Passed once; a failure is retried after the retry interval. */
  checked(release: string): Promise<Outcome> {
    const existing = this.entries.get(release);
    const expired =
      existing?.outcome !== undefined &&
      !existing.outcome.ok &&
      this.now() - (existing.settledAt ?? 0) >= this.retryMs;
    if (existing !== undefined && !expired) return existing.promise;
    return this.start(release).promise;
  }

  private start(release: string): Entry {
    const entry: Entry = { promise: this.run(release) };
    void entry.promise.then((outcome) => {
      entry.outcome = outcome;
      entry.settledAt = this.now();
    });
    this.entries.set(release, entry);
    return entry;
  }

  private async run(release: string): Promise<Outcome> {
    const verdict: VerifyResult = await verifyRelease(join(this.releasesDir, release), release);
    if (
      verdict.ok &&
      verdict.manifest !== undefined &&
      verdict.manifestBytes !== undefined &&
      verdict.stamps !== undefined
    ) {
      return {
        ok: true,
        manifest: verdict.manifest,
        manifestBytes: verdict.manifestBytes,
        digest: digestOf(verdict.manifestBytes),
        stamps: verdict.stamps,
      };
    }
    return { ok: false, missing: verdict.missing === true, problems: verdict.problems };
  }

  /**
   * Finds a file the Node may serve: `manifest.json`, or a file the manifest lists. Anything else is refused before the
   * disk is touched. A listed file that no longer matches what was checked makes the release be checked again.
   */
  async lookup(release: string, path: string): Promise<ServedFile | LookupFailure> {
    if (!isSafeReleaseName(release)) return "bad-name";
    if (!isSafeRelativePath(path)) return "bad-path";
    const outcome = await this.checked(release);
    if (!outcome.ok) return outcome.missing ? "no-release" : "unchecked";

    if (path === MANIFEST_FILE) {
      return fromMemory(outcome.manifestBytes, outcome.digest, contentTypeFor(path));
    }
    const listed = outcome.manifest.files.find((f) => f.path === path);
    if (listed === undefined) return "not-listed";
    return this.openListed(release, listed, outcome, true);
  }

  private async openListed(
    release: string,
    listed: ReleaseFile,
    outcome: Checked,
    mayRetry: boolean,
  ): Promise<ServedFile | LookupFailure> {
    const stamp = outcome.stamps.get(listed.path);
    const handle = await openNoFollow(join(this.releasesDir, release, listed.path));
    if (handle !== undefined && stamp !== undefined) {
      const info = await handle.stat();
      if (
        info.isFile() &&
        info.size === stamp.size &&
        info.size === listed.size &&
        info.mtimeMs === stamp.mtimeMs &&
        info.ino === stamp.ino &&
        info.dev === stamp.dev
      ) {
        return fromHandle(handle, listed, contentTypeFor(listed.path));
      }
    }
    await handle?.close();
    if (!mayRetry) return "unchecked";

    // Changed, replaced, or a link: the release is no longer what was checked. Check it again (hash everything).
    this.entries.delete(release);
    const again = await this.checked(release);
    if (!again.ok) return again.missing ? "no-release" : "unchecked";
    const fresh = again.manifest.files.find((f) => f.path === listed.path);
    if (fresh === undefined) return "not-listed";
    return this.openListed(release, fresh, again, false);
  }
}

/** Opens a file for reading without following a symbolic link. Undefined when it is missing or is a link. */
async function openNoFollow(path: string): Promise<FileHandle | undefined> {
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  try {
    return await open(path, flags);
  } catch {
    return undefined;
  }
}

function fromMemory(bytes: Buffer, sha512: string, contentType: string): ServedFile {
  return {
    size: bytes.length,
    sha512,
    contentType,
    stream: (start, end) =>
      end < start ? Readable.from([]) : Readable.from([bytes.subarray(start, end + 1)]),
    discard: () => {},
  };
}

function fromHandle(handle: FileHandle, listed: ReleaseFile, contentType: string): ServedFile {
  let done = false;
  return {
    size: listed.size,
    sha512: listed.sha512,
    contentType,
    stream: (start, end) => {
      done = true;
      if (end < start) {
        void handle.close();
        return Readable.from([]);
      }
      return handle.createReadStream({ start, end });
    },
    discard: () => {
      if (!done) {
        done = true;
        void handle.close();
      }
    },
  };
}
