// Checks a release folder against its manifest: the manifest's digest, every listed file's size and SHA-512, and
// that no unlisted file or symbolic link is present. Used by the verify script and by the Node before it routes.
import { createHash } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { readFile, lstat, readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
  DIGEST_FILE,
  MANIFEST_FILE,
  ManifestError,
  parseManifest,
  type ReleaseFile,
  type ReleaseManifest,
} from "./manifest.js";
import { isSafeRelativePath, RESERVED_TOP_LEVEL } from "./paths.js";
import { sha512FileAsync, sha512FileSync } from "./hash.js";

/** What a check saw of a listed file. A later read is served only while the file still matches this stamp. */
export interface FileStamp {
  readonly size: number;
  readonly mtimeMs: number;
  readonly ino: number;
  readonly dev: number;
}

export interface VerifyResult {
  readonly ok: boolean;
  readonly manifest?: ReleaseManifest;
  /** The exact manifest bytes that were checked. Serving uses these, never a second read of the file. */
  readonly manifestBytes?: Buffer;
  /** What the check saw of each listed file. */
  readonly stamps?: ReadonlyMap<string, FileStamp>;
  /** True when there is no manifest at all (a folder that is not a release). */
  readonly missing?: boolean;
  /** Plain reasons, one per problem. They name files and rules, never file contents. */
  readonly problems: readonly string[];
}

/** The release's files, relative and sorted, as a manifest lists them. Refuses symbolic links and reserved names. */
export function scanFiles(dir: string): ReleaseFile[] {
  const out: ReleaseFile[] = [];
  const walk = (folder: string, prefix: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const full = join(folder, entry.name);
      if (prefix === "" && (RESERVED_TOP_LEVEL as readonly string[]).includes(entry.name)) {
        throw new ManifestError(`${entry.name} is reserved; the staging folder must not hold it.`);
      }
      if (entry.isSymbolicLink())
        throw new ManifestError(`${rel} is a symbolic link; refusing to publish it.`);
      if (entry.isDirectory()) {
        walk(full, rel);
      } else if (entry.isFile()) {
        if (!isSafeRelativePath(rel))
          throw new ManifestError(`Unsafe file name in staging: ${JSON.stringify(rel)}`);
        out.push({ path: rel, size: statSync(full).size, sha512: sha512FileSync(full) });
      } else {
        throw new ManifestError(`${rel} is not a regular file.`);
      }
    }
  };
  walk(dir, "");
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Every regular file under `dir` (relative paths), excluding the two top-level manifest files. */
async function listFiles(dir: string): Promise<{ files: string[]; links: string[] }> {
  const files: string[] = [];
  const links: string[] = [];
  const walk = async (folder: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (prefix === "" && (RESERVED_TOP_LEVEL as readonly string[]).includes(entry.name)) continue;
      if (entry.isSymbolicLink()) links.push(rel);
      else if (entry.isDirectory()) await walk(join(folder, entry.name), rel);
      else if (entry.isFile()) files.push(rel);
      else links.push(rel);
    }
  };
  await walk(dir, "");
  return { files, links };
}

/**
 * Problems with the listed files: missing, not regular, wrong size, wrong SHA-512, or changed while it was read. When
 * `stamps` is given, each good file's stamp is recorded there. The stat is taken before and after the hash.
 */
export async function checkListedFiles(
  dir: string,
  files: readonly ReleaseFile[],
  stamps?: Map<string, FileStamp>,
): Promise<string[]> {
  const problems: string[] = [];
  for (const file of files) {
    if (!isSafeRelativePath(file.path)) {
      problems.push(`${JSON.stringify(file.path)} is not a safe path`);
      continue;
    }
    const full = join(dir, file.path);
    let before;
    try {
      before = await lstat(full);
    } catch {
      problems.push(`${file.path} is missing`);
      continue;
    }
    if (before.isSymbolicLink() || !before.isFile()) {
      problems.push(`${file.path} is not a regular file`);
      continue;
    }
    if (before.size !== file.size) {
      problems.push(`${file.path} has the wrong size`);
      continue;
    }
    const digest = await sha512FileAsync(full);
    const after = await lstat(full);
    if (
      after.ino !== before.ino ||
      after.dev !== before.dev ||
      after.mtimeMs !== before.mtimeMs ||
      after.size !== before.size
    ) {
      problems.push(`${file.path} changed while it was being checked`);
      continue;
    }
    if (digest !== file.sha512) {
      problems.push(`${file.path} does not match its SHA-512`);
      continue;
    }
    stamps?.set(file.path, {
      size: after.size,
      mtimeMs: after.mtimeMs,
      ino: after.ino,
      dev: after.dev,
    });
  }
  return problems;
}

/** The SHA-512 of manifest bytes, as the digest file records it. */
export function digestOf(bytes: Uint8Array | string): string {
  return createHash("sha512").update(bytes).digest("hex");
}

/** Full check of a release folder. Never throws for a bad release; it reports the problems instead. */
export async function verifyRelease(
  dir: string,
  expectedName = basename(resolve(dir)),
): Promise<VerifyResult> {
  const problems: string[] = [];
  let manifestBytes: Buffer;
  try {
    manifestBytes = await readFile(join(dir, MANIFEST_FILE));
  } catch {
    return { ok: false, missing: true, problems: [`${MANIFEST_FILE} is missing`] };
  }

  let digest: string;
  try {
    digest = (await readFile(join(dir, DIGEST_FILE), "utf8")).trim();
  } catch {
    digest = "";
    problems.push(`${DIGEST_FILE} is missing`);
  }
  if (digest !== "" && digest !== digestOf(manifestBytes)) {
    problems.push(
      `${MANIFEST_FILE} changed after the release was published (its ${DIGEST_FILE} does not match)`,
    );
  }

  let manifest: ReleaseManifest;
  try {
    manifest = parseManifest(manifestBytes.toString("utf8"));
  } catch (error) {
    const reason = error instanceof ManifestError ? error.message : "manifest could not be read";
    return { ok: false, problems: [...problems, reason] };
  }

  if (manifest.release !== expectedName) {
    problems.push(
      `manifest names a different release (${manifest.release}) than its folder (${expectedName})`,
    );
  }

  const stamps = new Map<string, FileStamp>();
  problems.push(...(await checkListedFiles(dir, manifest.files, stamps)));

  const listed = new Set(manifest.files.map((f) => f.path));
  const found = await listFiles(dir);
  for (const path of found.links) problems.push(`${path} is a symbolic link or other special file`);
  for (const path of found.files) {
    if (!listed.has(path)) problems.push(`${path} is not in the manifest`);
  }

  return { ok: problems.length === 0, manifest, manifestBytes, stamps, problems };
}
