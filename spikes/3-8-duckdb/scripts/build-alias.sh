#!/bin/sh
# usage: build-alias.sh <alias> [shim]  -> .tmp/dist-<alias>[-shim] (self-hosted bundles of that version)
# "shim" swaps apache-arrow's eval-based isValid builder for a CSP-safe one.
set -e
cd "$(dirname "$0")/.."
node scripts/copy-bundles.mjs "$1"
if [ "$2" = "shim" ]; then
  ARROW_SHIM=1 DUCKDB_ALIAS="$1" OUT_DIR=".tmp/dist-$1-shim" npx vp build >/dev/null
  echo "built .tmp/dist-$1-shim"
else
  DUCKDB_ALIAS="$1" OUT_DIR=".tmp/dist-$1" npx vp build >/dev/null
  echo "built .tmp/dist-$1"
fi
