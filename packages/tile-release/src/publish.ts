// Writes a release folder once. A name that exists is never overwritten: the same bytes change nothing, different
// bytes are refused and the existing release is left as it was.
//
// The copy is checked again after it is made and before it is renamed into place: the folder that is published is the
// one that was checked, so a file or link that appears in the staging folder after the scan is refused.
import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DIGEST_FILE,
  MANIFEST_FILE,
  serializeManifest,
  type ReleaseFile,
  type ReleaseManifest,
} from "./manifest.js";
import { isSafeReleaseName } from "./paths.js";
import { checkListedFiles, digestOf, scanFiles } from "./verify.js";

export class ReleaseExistsError extends Error {
  readonly release: string;
  constructor(release: string) {
    super(`Release ${release} already exists.`);
    this.name = "ReleaseExistsError";
    this.release = release;
  }
}

export interface PublishSeams {
  /** Test-only: runs after the staging folder is scanned and before it is copied. */
  readonly afterStagingScan?: () => void;
}

export interface PublishInput {
  readonly releasesDir: string;
  /** The folder the build wrote the map files into. Copied, never moved, so a failed publish leaves it intact. */
  readonly stagingDir: string;
  readonly manifest: ReleaseManifest;
  readonly seams?: PublishSeams;
}

export type PublishResult = { readonly status: "created" | "unchanged"; readonly dir: string };

const fileKey = (f: ReleaseFile) => `${f.path}:${f.size}:${f.sha512}`;

function sameFiles(expected: readonly ReleaseFile[], actual: readonly ReleaseFile[]): boolean {
  return [...expected].map(fileKey).join("\n") === [...actual].map(fileKey).join("\n");
}

export async function publishRelease(input: PublishInput): Promise<PublishResult> {
  const { releasesDir, stagingDir, manifest } = input;
  const name = manifest.release;
  if (!isSafeReleaseName(name)) throw new Error("Release name is not allowed.");

  const bytes = serializeManifest(manifest);
  const target = join(releasesDir, name);

  if (await exists(target)) {
    const existing = await readFile(join(target, MANIFEST_FILE), "utf8").catch(() => undefined);
    if (existing === bytes) return { status: "unchanged", dir: target };
    throw new ReleaseExistsError(name);
  }

  // The staging folder must hold exactly the files the manifest lists, before anything is written.
  if (!sameFiles(manifest.files, scanFiles(stagingDir))) {
    throw new Error(
      "The map files in the build folder do not match the manifest; nothing was published.",
    );
  }
  input.seams?.afterStagingScan?.();

  await mkdir(releasesDir, { recursive: true });
  const incoming = join(releasesDir, `.incoming-${name}-${randomUUID()}`);
  try {
    await cp(stagingDir, incoming, {
      recursive: true,
      errorOnExist: true,
      force: false,
      dereference: false,
    });

    // Checked again on the copy: nothing unlisted, no link, and every listed file hashes to the manifest.
    if (!sameFiles(manifest.files, scanFiles(incoming))) {
      throw new Error("The copied map files do not match the manifest; nothing was published.");
    }
    await writeFile(join(incoming, MANIFEST_FILE), bytes);
    await writeFile(join(incoming, DIGEST_FILE), `${digestOf(bytes)}\n`);
    const problems = await checkListedFiles(incoming, manifest.files);
    if (problems.length > 0)
      throw new Error(`The copied release does not match its manifest: ${problems.join("; ")}`);

    try {
      await rename(incoming, target);
    } catch (error) {
      // Another publish under this name finished first. Its release stands; this one is refused.
      if (await exists(target)) throw new ReleaseExistsError(name);
      throw error;
    }
  } finally {
    await rm(incoming, { recursive: true, force: true });
  }
  return { status: "created", dir: target };
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}
