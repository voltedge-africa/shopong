#!/usr/bin/env bash
# Download the small pinned OpenStreetMap extract used to build Valhalla tiles in the sandbox.
#
#   Region:   Eswatini (Geofabrik names it "swaziland"), ~31 MB
#   Snapshot: 2026-10-23 (dated file, so the bytes stay stable)
#   Licence:  ODbL 1.0. Data (c) OpenStreetMap contributors. Extract by Geofabrik GmbH.
#             Attribution is required wherever the data, or tiles built from it, are shown.
#
# Integrity: Geofabrik publishes an MD5 next to each file; we check it, and also pin a SHA-256 in
# swaziland-261023.osm.pbf.sha256 (committed). If that file is missing the SHA-256 is recorded on
# first fetch. Dated Geofabrik files are removed after a while: if the download 404s, pick a newer
# snapshot, delete the .sha256 file, change SNAPSHOT below, and commit the new .sha256.
#
# Output: .cache/osm/ (gitignored). The extract is never committed.
set -euo pipefail

SNAPSHOT="261023"
NAME="swaziland-${SNAPSHOT}.osm.pbf"
URL="https://download.geofabrik.de/africa/${NAME}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
out_dir="$repo/.cache/osm"
out="$out_dir/$NAME"
pin="$here/${NAME}.sha256"

sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
md5() { if command -v md5sum >/dev/null; then md5sum "$1" | cut -d' ' -f1; else md5 -q "$1"; fi; }

mkdir -p "$out_dir"

verify() {
  local got; got="$(sha256 "$1")"
  if [[ -f "$pin" ]]; then
    local want; want="$(cut -d' ' -f1 "$pin")"
    [[ "$got" == "$want" ]] || { echo "SHA-256 mismatch for $1: expected $want, got $got" >&2; return 1; }
    echo "SHA-256 verified against $(basename "$pin")"
  else
    echo "$got  $NAME" > "$pin"
    echo "No pin existed: recorded SHA-256 $got in $pin. Commit that file."
  fi
}

if [[ -f "$out" ]] && verify "$out" 2>/dev/null; then
  echo "Already present and verified: $out"
else
  tmp="$(mktemp "$out_dir/.download.XXXXXX")"
  trap 'rm -f "$tmp"' EXIT
  echo "Downloading $URL"
  curl --fail --location --silent --show-error --output "$tmp" "$URL"
  want_md5="$(curl --fail --silent --show-error "${URL}.md5" | cut -d' ' -f1)"
  got_md5="$(md5 "$tmp")"
  [[ "$want_md5" == "$got_md5" ]] || { echo "MD5 mismatch: Geofabrik says $want_md5, got $got_md5" >&2; exit 1; }
  echo "MD5 verified against Geofabrik"
  verify "$tmp"
  mv "$tmp" "$out"
  trap - EXIT
fi

echo "Saved: $out ($(du -h "$out" | cut -f1))"
echo "Attribution: (c) OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)"
