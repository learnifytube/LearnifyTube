#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

mobile_to_tv="$(grep -rEn --include='*.ts' --include='*.tsx' "from ['\"](\.\./)*\(tv\)|from ['\"]/\(tv\)|router\.(push|replace)\(['\"]/\(tv\)|<Link href=['\"]/\(tv\)" app/'(mobile)' || true)"
tv_to_mobile="$(grep -rEn --include='*.ts' --include='*.tsx' "from ['\"](\.\./)*\(mobile\)|from ['\"]/\(mobile\)|router\.(push|replace)\(['\"]/\(mobile\)|<Link href=['\"]/\(mobile\)" app/'(tv)' || true)"

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
