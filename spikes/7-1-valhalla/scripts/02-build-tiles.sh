#!/usr/bin/env bash
# Build Valhalla tiles + graph.tar + manifest.json + config.json for the pinned Eswatini extract using the
# valhalla-wasm dataset pipeline (scripts/build-dataset.py, run in the same Docker image as the native tools).
# Output: .cache/valhalla/datasets/<release-id>/  (gitignored). Timing and sizes go to results/tile-build.json.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
src="$repo/.cache/src/valhalla-wasm"
pbf="$repo/.cache/osm/swaziland-261023.osm.pbf"
[[ -f "$pbf" ]] || bash "$repo/scripts/sandbox/fetch-osm-extract.sh"
mkdir -p "$src/build/inputs" "$repo/.cache/valhalla/datasets"
cp -f "$pbf" "$src/build/inputs/eswatini-261023.osm.pbf"
cd "$src"
NAME="${NAME:-eswatini-2026-10-23}"
# Extract header bbox (west,south,east,north): 30.785751,-27.318256,32.136984,-25.717811
start=$(date +%s.%N)
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" -w /work valhalla-browser-build \
  python3 scripts/build-dataset.py \
    --pbf build/inputs/eswatini-261023.osm.pbf \
    --name "$NAME" \
    --bbox=30.785751,-27.318256,32.136984,-25.717811 \
    --source-url https://download.geofabrik.de/africa/swaziland-261023.osm.pbf \
    --threads "${THREADS:-4}" 2>&1 | tee "$here/../results/tile-build.log"
end=$(date +%s.%N)
printf '{"wallSeconds": %.1f, "threads": %s}\n' "$(echo "$end - $start" | bc)" "${THREADS:-4}" > "$here/../results/tile-build-time.json"
# Publish into the dataset root the spike servers use.
rel="$(ls -1t public/datasets | head -1)"
rm -rf "$repo/.cache/valhalla/datasets/$rel"
cp -r "public/datasets/$rel" "$repo/.cache/valhalla/datasets/$rel"
echo "$rel" > "$repo/.cache/valhalla/RELEASE"
echo "release: $rel"
