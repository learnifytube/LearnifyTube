#!/usr/bin/env bash
set -euo pipefail
out="${1:-}"
if [[ -z "$out" ]]; then
  echo "Usage: adb-screencap.sh <png>" >&2
  exit 1
fi
mkdir -p "$(dirname "$out")"
adb exec-out screencap -p > "$out"
echo "$out"
