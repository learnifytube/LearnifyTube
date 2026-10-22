#!/usr/bin/env bash
# Links the main checkout's node_modules into this git worktree, so tests,
# lint, type-check and the pre-commit hook run without a fresh install.
# The links are gitignored; leave them in place.
set -euo pipefail

worktree="$(git rev-parse --show-toplevel)"
main="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"

if [[ "$worktree" == "$main" ]]; then
  echo "[worktree-deps] this is the main checkout; nothing to link"
  exit 0
fi

for dir in . apps/desktop apps/mobile; do
  source="$main/$dir/node_modules"
  target="$worktree/$dir/node_modules"
  if [[ ! -d "$source" ]]; then
    echo "[worktree-deps] missing $source; run npm ci there first" >&2
    exit 1
  fi
  if [[ -e "$target" || -L "$target" ]]; then
    continue
  fi
  ln -s "$source" "$target"
  echo "[worktree-deps] linked $dir/node_modules"
done
