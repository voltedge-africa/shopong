// Names and paths the release code accepts. Anything else is refused before it touches the disk.

/** The alias the Node's routes use for the active release. It can never be a release name. */
export const ACTIVE_ALIAS = "active";

/** Top-level names a release folder uses for its own manifest files. A file of these names is never a map file. */
export const RESERVED_TOP_LEVEL = ["manifest.json", "manifest.sha512"] as const;

const RELEASE_NAME = /^[a-z0-9][a-z0-9.-]{0,79}$/u;

/** Lowercase letters, digits, dots and hyphens; no `..`; never `active`; at most 80 characters. */
export function isSafeReleaseName(name: string): boolean {
  return (
    RELEASE_NAME.test(name) && name !== ACTIVE_ALIAS && !name.includes("..") && !name.endsWith(".")
  );
}

const MAX_PATH = 512;
const MAX_SEGMENT = 255;

/**
 * A path inside a release folder, with `/` separators. No leading slash, no backslash, no control bytes, no empty,
 * `.` or `..` segment, and no segment that starts with a dot (so `.incoming-*` folders and dotfiles are never served).
 */
export function isSafeRelativePath(path: string): boolean {
  if (path.length === 0 || path.length > MAX_PATH) return false;
  if (path.startsWith("/") || path.includes("\\")) return false;
  // Control characters, including NUL and newline.
  for (let i = 0; i < path.length; i++) {
    const code = path.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return path
    .split("/")
    .every(
      (segment) =>
        segment.length > 0 &&
        segment.length <= MAX_SEGMENT &&
        !segment.startsWith(".") &&
        segment !== "..",
    );
}

export type ByteRange =
  | { kind: "full" }
  | { kind: "partial"; start: number; end: number }
  | { kind: "unsatisfiable" };

/**
 * A single `bytes=` range against a file of `size` bytes (RFC 9110). A missing, non-bytes, multi-range or malformed
 * header answers the whole file. A range that cannot be met answers `unsatisfiable` (416).
 */
export function parseByteRange(header: string | undefined, size: number): ByteRange {
  if (header === undefined) return { kind: "full" };
  if (!header.startsWith("bytes=") || header.includes(",")) return { kind: "full" };
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header);
  if (match === null) return { kind: "full" };
  const [, first = "", last = ""] = match;
  if (first === "" && last === "") return { kind: "full" };
  if (size === 0) return { kind: "unsatisfiable" };

  if (first === "") {
    // Suffix range: the last N bytes.
    const suffix = Number(last);
    if (suffix === 0) return { kind: "unsatisfiable" };
    return { kind: "partial", start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(first);
  if (start >= size) return { kind: "unsatisfiable" };
  if (last === "") return { kind: "partial", start, end: size - 1 };
  const end = Math.min(Number(last), size - 1);
  if (end < start) return { kind: "full" };
  return { kind: "partial", start, end };
}

/** The media type for a release file, by its extension. */
export function contentTypeFor(path: string): string {
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".tar")) return "application/x-tar";
  if (path.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}
