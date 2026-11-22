#!/bin/sh
set -eu

mode="${1:-staged}"
lockfiles=":(exclude)bun.lock"
legacy_lockfiles=":(exclude)pnpm-lock.yaml"

if ! command -v betterleaks >/dev/null 2>&1; then
  echo "betterleaks が見つからないので秘密情報の検査を飛ばします(CI では必ず実行されます)。" >&2
  echo "入れ方: brew install betterleaks / go install github.com/betterleaks/betterleaks@v1.10.1" >&2
  exit 0
fi

case "$mode" in
  staged)
    git diff --cached --no-color --unified=0 -- . "$lockfiles" "$legacy_lockfiles" | betterleaks stdin --redact --no-banner
    ;;
  push)
    base="$(git rev-parse --verify --quiet '@{upstream}' || git rev-parse --verify --quiet origin/main || true)"
    if [ -z "$base" ]; then
      git log --no-color -p HEAD -- . "$lockfiles" "$legacy_lockfiles" | betterleaks stdin --redact --no-banner
    else
      git log --no-color -p "$base..HEAD" -- . "$lockfiles" "$legacy_lockfiles" | betterleaks stdin --redact --no-banner
    fi
    ;;
  all)
    betterleaks git . --config .betterleaks.toml --redact --no-banner
    ;;
  *)
    echo "usage: secrets.sh staged|push|all" >&2
    exit 2
    ;;
esac
