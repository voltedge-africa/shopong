#!/usr/bin/env bash
# Build the pinned native Valhalla 3.8.3 tile tools (valhalla_build_tiles, valhalla_build_admins,
# native-reference) inside the valhalla-wasm project's own Docker image. Native stage only: no WASM build.
# Output: .cache/src/valhalla-wasm/build/native (gitignored). Records wall time in results/native-tools-build.txt.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
src="$repo/.cache/src/valhalla-wasm"
JOBS="${BUILD_JOBS:-10}"
if [[ ! -d "$src/.git" ]]; then
  git clone https://github.com/tobilg/valhalla-wasm "$src"
fi
git -C "$src" checkout --quiet v0.2.1   # same build inputs as the 0.2.1 npm packages
cd "$src"
mkdir -p build
start=$(date +%s)
docker build -t valhalla-browser-build -f scripts/Dockerfile . > build/docker-image.log
docker run --rm --user "$(id -u):$(id -g)" -e BUILD_JOBS="$JOBS" -v "$PWD:/work" -w /work \
  valhalla-browser-build bash scripts/build-container.sh native > build/native-build.log
end=$(date +%s)
mkdir -p "$here/../results"
echo "native tools build: $((end-start)) s wall, BUILD_JOBS=$JOBS, host $(nproc) cores" | tee "$here/../results/native-tools-build.txt"
