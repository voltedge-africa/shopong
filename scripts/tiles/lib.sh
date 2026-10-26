# Shared helpers for the tile release scripts. Sourced, never run. Story 7.2.
#
# SCRATCH holds large downloads and builds. It defaults to a folder under your home directory, not a shared /tmp path,
# and every run checks it: it must be a real folder (not a symbolic link) that you own, with no group or other write
# access. Nothing large goes under the repository.

TILES_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TILES_HERE/../.." && pwd)"
SCRATCH="${SCRATCH:-$HOME/.cache/ocn-tiles}"
CLI=(node "$REPO/packages/tile-release/dist/cli.js")

die() { echo "$*" >&2; exit 1; }

sha256_of() {
  if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

md5_of() {
  if command -v md5sum >/dev/null; then md5sum "$1" | cut -d' ' -f1; else md5 -q "$1"; fi
}

# Refuses a folder inside the repository. Resolved as text, before anything is created there.
outside_repo() {
  local target
  target="$(node -p 'require("node:path").resolve(process.argv[1])' "$1")"
  case "$target/" in
    "$REPO/"*) die "$2 must be outside the repository ($REPO): map data is never committed." ;;
  esac
}

# Creates (private, mode 0700) or checks an existing scratch folder: a real folder, owned by the current user, with no
# group or other write access.
ensure_private_dir() {
  local dir="$1" label="$2" state
  if [[ -L "$dir" ]]; then die "$label ($dir) is a symbolic link; refusing to use it."; fi
  if [[ ! -e "$dir" ]]; then (umask 077 && mkdir -p -- "$dir") || die "$label ($dir) could not be created."; fi
  [[ -d "$dir" ]] || die "$label ($dir) is not a folder."
  state="$(node -p 'const s = require("node:fs").statSync(process.argv[1]); `${s.uid} ${(s.mode & 0o022) ? "open" : "closed"}`' "$dir")"
  [[ "$state" == "$(id -u) closed" ]] \
    || die "$label ($dir) must be a folder you own with no group or other write access (chmod 700). Refusing to use it."
}

# A release name: lowercase letters, digits, dots and hyphens; not the alias "active"; no "..".
check_release_name() {
  local name="$1"
  [[ "$name" =~ ^[a-z0-9][a-z0-9.-]{0,79}$ && "$name" != active && "$name" != *..* && "$name" != *. ]] \
    || die "Release name is not allowed: use lowercase letters, digits, dots and hyphens, for example kwazulu-natal-2026-10-23."
}
