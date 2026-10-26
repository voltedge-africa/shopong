#!/usr/bin/env bash
# Downloads the OpenStreetMap extract named by a pin into $SCRATCH/osm and checks it before anything is built:
# Geofabrik's published MD5 (when the pin names one), then the pinned SHA-256. A mismatch deletes the download.
# Prints the extract's path as its last line. Usage: fetch-extract.sh <pin.json>
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

pin="${1:?usage: fetch-extract.sh <pin.json>}"
"${CLI[@]}" pin-check "$pin" >/dev/null || die "The pin is not usable: see the message above."

file="$("${CLI[@]}" pin-get "$pin" source.file)"
url="$("${CLI[@]}" pin-get "$pin" source.url)"
want_sha="$("${CLI[@]}" pin-get "$pin" source.sha256)"
md5_url="$("${CLI[@]}" pin-get "$pin" source.md5Url 2>/dev/null || true)"

ensure_private_dir "$SCRATCH" "SCRATCH"
out_dir="$SCRATCH/osm"
outside_repo "$out_dir" "The extract folder"
(umask 077 && mkdir -p -- "$out_dir")
out="$out_dir/$file"

if [[ -f "$out" && "$(sha256_of "$out")" == "$want_sha" ]]; then
  echo "Already present and verified: $out ($(wc -c <"$out" | tr -d ' ') bytes)" >&2
  echo "$out"
  exit 0
fi

tmp="$(mktemp "$out_dir/.download.XXXXXX")"
trap 'rm -f -- "$tmp"' EXIT
echo "Downloading $url" >&2
start=$(date +%s)
bytes="$(curl --fail --location --silent --show-error --output "$tmp" --write-out '%{size_download}' "$url")"
seconds=$(( $(date +%s) - start ))
echo "Downloaded $bytes bytes in ${seconds} s" >&2

if [[ -n "$md5_url" ]]; then
  want_md5="$(curl --fail --silent --show-error "$md5_url" | cut -d' ' -f1)"
  [[ "$(md5_of "$tmp")" == "$want_md5" ]] || die "The map file didn't match its checksum (Geofabrik MD5)."
  echo "MD5 verified against Geofabrik" >&2
fi
[[ "$(sha256_of "$tmp")" == "$want_sha" ]] || die "The map file didn't match its checksum."
echo "SHA-256 verified against the pin" >&2

mv -- "$tmp" "$out"
trap - EXIT
echo "$out"
