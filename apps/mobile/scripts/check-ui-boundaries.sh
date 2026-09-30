#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if ! command -v rg >/dev/null 2>&1; then
  echo "[ui-boundary] ripgrep (rg) is required but not installed" >&2
  exit 1
fi

mobile_to_tv="$(rg -n "from ['\"](\.\./)*\(tv\)|from ['\"]/\(tv\)|router\.(push|replace)\(['\"]/\(tv\)|<Link href=['\"]/\(tv\)" app/'(mobile)' -S || true)"
tv_to_mobile="$(rg -n "from ['\"](\.\./)*\(mobile\)|from ['\"]/\(mobile\)|router\.(push|replace)\(['\"]/\(mobile\)|<Link href=['\"]/\(mobile\)" app/'(tv)' -S || true)"

if [[ -n "$mobile_to_tv" ]]; then
  echo "[ui-boundary] mobile surface must not import or navigate directly into tv surface:" >&2
  echo "$mobile_to_tv" >&2
  exit 1
fi

if [[ -n "$tv_to_mobile" ]]; then
  echo "[ui-boundary] tv surface must not import or navigate directly into mobile surface:" >&2
  echo "$tv_to_mobile" >&2
  exit 1
fi

echo "[ui-boundary] OK"
