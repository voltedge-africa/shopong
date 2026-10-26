#!/usr/bin/env bash
# Builds one immutable map release from a pinned OpenStreetMap extract, with the pinned Valhalla builder in Docker
# (the spike's pipeline, valhalla-wasm v0.2.1). Writes tiles, graph.tar, config.json and the release manifest
# (SHA-512 and size of every file, plus the ODbL attribution) into RELEASES_DIR/<release-name>.
#
# A name that already exists is never overwritten: the same bytes change nothing, different bytes are refused and the
# existing release is left as it was. Everything large goes under SCRATCH (private, see lib.sh), never the repository.
# Native tools are reused only when the pinned commit is checked out and the recorded SHA-256 of each binary matches.
#
# Usage: RELEASES_DIR=/srv/ocn/map-releases [SCRATCH=~/.cache/ocn-tiles] build-release.sh <pin.json> <release-name>
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

pin="${1:?usage: build-release.sh <pin.json> <release-name>}"
release="${2:?usage: build-release.sh <pin.json> <release-name>}"
check_release_name "$release"

RELEASES_DIR="${RELEASES_DIR:?set RELEASES_DIR to a folder outside the repository}"
outside_repo "$RELEASES_DIR" "RELEASES_DIR"
outside_repo "$SCRATCH" "SCRATCH"
ensure_private_dir "$SCRATCH" "SCRATCH"
THREADS="${THREADS:-8}"
BUILD_JOBS="${BUILD_JOBS:-10}"

WASM_REPO_URL="https://github.com/tobilg/valhalla-wasm"
WASM_TAG="v0.2.1"
WASM_COMMIT="b09d0ceb6673801d9e8eeb30c43927b89300c553"

logs="$SCRATCH/logs"
(umask 077 && mkdir -p -- "$logs")

"${CLI[@]}" pin-check "$pin" >/dev/null || die "The pin is not usable (see the message above); nothing was built."
command -v docker >/dev/null && docker info >/dev/null 2>&1 || die "Docker is needed to build map data."
(cd "$REPO" && pnpm --filter @shopong/tile-release run build >&2)

# 1. The extract, checked before anything else.
extract="$(bash "$TILES_HERE/fetch-extract.sh" "$pin")"
extract_dir="$(dirname "$extract")"
pbf_name="$(basename "$extract")"

# 2. The pinned builder source, and its native tools inside the Docker image.
src="$SCRATCH/src/valhalla-wasm"
(umask 077 && mkdir -p -- "$SCRATCH/src")
if [[ ! -d "$src/.git" ]]; then git clone --quiet "$WASM_REPO_URL" "$src"; fi
git -C "$src" checkout --quiet "$WASM_TAG"
[[ "$(git -C "$src" rev-parse HEAD)" == "$WASM_COMMIT" ]] || die "valhalla-wasm $WASM_TAG is not the pinned commit; refusing to build."

native_tools=(native-reference upstream/valhalla_build_admins upstream/valhalla_build_tiles)
native_record="$src/build/native-tools.sha256"
tools_now() {
  local tool
  for tool in "${native_tools[@]}"; do
    [[ -f "$src/build/native/$tool" ]] && printf '%s  %s\n' "$(sha256_of "$src/build/native/$tool")" "$tool"
  done
  return 0
}

(cd "$src" && docker build -t valhalla-browser-build -f scripts/Dockerfile . >"$logs/docker-image.log" 2>&1) \
  || die "Docker could not build the builder image; see $logs/docker-image.log"
now="$(tools_now)"
if [[ -n "$now" && -f "$native_record" && "$now" == "$(cat -- "$native_record")" ]]; then
  echo "Reusing native tools whose SHA-256 matches the recorded build." >&2
else
  native_start=$(date +%s)
  mkdir -p -- "$src/build"
  (cd "$src" && docker run --rm --user "$(id -u):$(id -g)" -e BUILD_JOBS="$BUILD_JOBS" -v "$src:/work" -w /work \
    valhalla-browser-build bash scripts/build-container.sh native >"$logs/native-build.log" 2>&1) \
    || die "The native tools did not build; see $logs/native-build.log"
  now="$(tools_now)"
  [[ -n "$now" ]] || die "The native tools were not produced; see $logs/native-build.log"
  printf '%s\n' "$now" >"$native_record"
  echo "Native tools built in $(( $(date +%s) - native_start )) s." >&2
fi

# 3. The tile build, in Docker, into a fresh folder under SCRATCH. The folder is removed on exit, whatever happens.
work="$SCRATCH/builds/$release-$(date +%Y%m%d%H%M%S)"
(umask 077 && mkdir -p -- "$work/out")
trap 'rm -rf -- "$work"' EXIT
bbox="$("${CLI[@]}" pin-get "$pin" coverage | tr -d '[] ')"
source_url="$("${CLI[@]}" pin-get "$pin" source.url)"
echo "Building $release from $pbf_name with $THREADS threads." >&2
build_start=$(date +%s)
(cd "$src" && docker run --rm --user "$(id -u):$(id -g)" -v "$src:/work" -v "$extract_dir:/input:ro" -v "$work/out:/out" \
  -w /work valhalla-browser-build \
  python3 scripts/build-dataset.py --pbf "/input/$pbf_name" --name "$release" --bbox "$bbox" \
  --source-url "$source_url" --threads "$THREADS" --output /out --work-dir /out/work) >"$logs/build-$release.log" 2>&1 \
  || { tail -n 5 -- "$logs/build-$release.log" >&2; die "The tile build failed; see $logs/build-$release.log"; }
echo "Tile build: $(( $(date +%s) - build_start )) s wall." >&2

# 4. Keep the release's files, rename the builder's own manifest (ours is manifest.json), publish, verify.
shopt -s nullglob
dirs=("$work/out/$release"-*)
shopt -u nullglob
[[ ${#dirs[@]} -eq 1 && -d "${dirs[0]}" ]] || die "The builder did not write exactly one release folder; nothing was published."
dataset_dir="${dirs[0]}"
staging="$work/staging"
mkdir -p -- "$staging"
mv -- "$dataset_dir/graph.tar" "$dataset_dir/config.json" "$dataset_dir/tiles" "$staging/"
mv -- "$dataset_dir/manifest.json" "$staging/valhalla-manifest.json"
[[ -z "$(ls -A -- "$dataset_dir")" ]] || die "The builder wrote files the release does not expect; nothing was published."

report="$work/out/work/build-report.json"
published="$("${CLI[@]}" publish --releases-dir "$RELEASES_DIR" --staging "$staging" --pin "$pin" \
  --build-report "$report" --release "$release")" || die "The release was not written (see the message above)."
"${CLI[@]}" verify --releases-dir "$RELEASES_DIR" --release "$release" >&2
echo "Published: $published" >&2

shopt -s nullglob
tz_files=("$src"/build/inputs/timezones-with-oceans-1970*.zip)
shopt -u nullglob
if [[ ${#tz_files[@]} -gt 0 ]]; then
  echo "Timezone input (downloaded by the builder, not by fetch-extract): $(wc -c <"${tz_files[0]}" | tr -d ' ') bytes" >&2
fi
echo "$published"
