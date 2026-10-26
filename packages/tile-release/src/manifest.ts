// The release manifest: what a release is, where its data came from, the attribution every surface shows, and the
// SHA-512 and size of every file in the release. A release's identity is its manifest's bytes.
import { isSafeReleaseName, isSafeRelativePath, RESERVED_TOP_LEVEL } from "./paths.js";

export const MANIFEST_SCHEMA = "ocn.map-release/1";
export const MANIFEST_FILE = "manifest.json";
export const DIGEST_FILE = "manifest.sha512";

export type Bbox = readonly [number, number, number, number];

export interface ReleaseFile {
  readonly path: string;
  readonly size: number;
  readonly sha512: string;
}

export interface Attribution {
  /** The full credit line, shown in the app's corner and in the console. */
  readonly text: string;
  /** The short link text, for example "© OpenStreetMap contributors (ODbL)". */
  readonly linkText: string;
  /** Where the link goes. */
  readonly url: string;
  readonly licence: string;
  /** Plain note on what is still unsettled (the share-alike position). */
  readonly note: string;
}

export interface ReleaseManifest {
  readonly schema: typeof MANIFEST_SCHEMA;
  readonly release: string;
  readonly region: string;
  readonly source: {
    readonly file: string;
    readonly url: string;
    /** The extract's snapshot date (YYYY-MM-DD), from the pin. Not the day the download ran. */
    readonly snapshotDate: string;
    /** SHA-256 of the extract, checked before any build. */
    readonly sha256: string;
    /** The timezone-boundary input the native build also downloads (ODbL), when the build reports it. */
    readonly timezoneInput?: {
      readonly release: string;
      readonly url: string;
      readonly sha256: string;
      readonly licence: string;
    };
  };
  /** The declared coverage box. A point inside it is routed even across a border (spike 7.1). */
  readonly coverage: Bbox;
  readonly builder: {
    /** The Valhalla version of the native builder, for example 3.8.3. */
    readonly valhallaVersion: string;
    /** The git commit of the pinned Valhalla source. */
    readonly valhallaRevision: string;
    /** The wrapper the build ran through, with its tag and commit. */
    readonly wrapper: string;
    readonly nativeBuilderSha256: string;
  };
  readonly attribution: Attribution;
  readonly files: readonly ReleaseFile[];
}

/** The input to a manifest. `files` comes from scanning the staging folder. */
export type ManifestInput = Omit<ReleaseManifest, "schema" | "files"> & {
  readonly files: readonly ReleaseFile[];
};

export class ManifestError extends Error {}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function checkAttribution(attribution: Attribution): void {
  if (
    !nonEmpty(attribution.text) ||
    !nonEmpty(attribution.linkText) ||
    !nonEmpty(attribution.url)
  ) {
    throw new ManifestError("Add the OpenStreetMap attribution.");
  }
  if (!attribution.url.startsWith("https://")) {
    throw new ManifestError("The attribution link must be an https address.");
  }
}

function checkFiles(files: readonly ReleaseFile[]): void {
  const seen = new Set<string>();
  for (const file of files) {
    if (!isSafeRelativePath(file.path))
      throw new ManifestError(`Unsafe file path in manifest: ${JSON.stringify(file.path)}`);
    if ((RESERVED_TOP_LEVEL as readonly string[]).includes(file.path)) {
      throw new ManifestError(`${file.path} is reserved for the release manifest.`);
    }
    if (seen.has(file.path)) throw new ManifestError(`Duplicate file in manifest: ${file.path}`);
    seen.add(file.path);
    if (!Number.isSafeInteger(file.size) || file.size < 0)
      throw new ManifestError(`Bad size for ${file.path}`);
    if (!/^[0-9a-f]{128}$/u.test(file.sha512))
      throw new ManifestError(`Bad SHA-512 for ${file.path}`);
  }
}

/** Builds a manifest with a fixed key order and sorted files, so the same inputs always give the same bytes. */
export function createManifest(input: ManifestInput): ReleaseManifest {
  if (!isSafeReleaseName(input.release)) throw new ManifestError("Release name is not allowed.");
  checkAttribution(input.attribution);
  checkFiles(input.files);
  const files = [...input.files]
    .map((f) => ({ path: f.path, size: f.size, sha512: f.sha512 }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    schema: MANIFEST_SCHEMA,
    release: input.release,
    region: input.region,
    source: {
      file: input.source.file,
      url: input.source.url,
      snapshotDate: input.source.snapshotDate,
      sha256: input.source.sha256,
      ...(input.source.timezoneInput === undefined
        ? {}
        : { timezoneInput: input.source.timezoneInput }),
    },
    coverage: input.coverage,
    builder: {
      valhallaVersion: input.builder.valhallaVersion,
      valhallaRevision: input.builder.valhallaRevision,
      wrapper: input.builder.wrapper,
      nativeBuilderSha256: input.builder.nativeBuilderSha256,
    },
    attribution: {
      text: input.attribution.text,
      linkText: input.attribution.linkText,
      url: input.attribution.url,
      licence: input.attribution.licence,
      note: input.attribution.note,
    },
    files,
  };
}

export function serializeManifest(manifest: ReleaseManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** Parses and checks a manifest read from disk. Throws ManifestError; a bad manifest is never partly used. */
export function parseManifest(text: string): ReleaseManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ManifestError("manifest is not valid JSON");
  }
  const m = raw as Partial<ReleaseManifest> | null;
  if (typeof m !== "object" || m === null) throw new ManifestError("manifest is not an object");
  if (m.schema !== MANIFEST_SCHEMA) throw new ManifestError("manifest has an unknown schema");
  if (typeof m.release !== "string" || !isSafeReleaseName(m.release)) {
    throw new ManifestError("manifest has an unsafe release name");
  }
  if (!nonEmpty(m.region)) throw new ManifestError("manifest has no region");
  const coverage = m.coverage;
  if (!Array.isArray(coverage) || coverage.length !== 4 || !coverage.every(Number.isFinite)) {
    throw new ManifestError("manifest has a bad coverage box");
  }
  if (typeof m.source !== "object" || m.source === null || !nonEmpty(m.source.sha256)) {
    throw new ManifestError("manifest has no source checksum");
  }
  if (typeof m.attribution !== "object" || m.attribution === null) {
    throw new ManifestError("Add the OpenStreetMap attribution.");
  }
  checkAttribution(m.attribution as Attribution);
  if (!Array.isArray(m.files)) throw new ManifestError("manifest has no file list");
  checkFiles(m.files as ReleaseFile[]);
  return m as ReleaseManifest;
}
