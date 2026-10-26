#!/usr/bin/env bash
# Checks a published release folder against its manifest (the manifest's digest, every file's size and SHA-512, and
# no unlisted file). Usage: verify-release.sh <releases-dir> <release-name>
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

releases="${1:?usage: verify-release.sh <releases-dir> <release-name>}"
release="${2:?usage: verify-release.sh <releases-dir> <release-name>}"
check_release_name "$release"
"${CLI[@]}" verify --releases-dir "$releases" --release "$release"
