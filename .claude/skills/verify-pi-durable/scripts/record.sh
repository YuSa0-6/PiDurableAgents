#!/bin/sh
set -eu
root="$(git rev-parse --show-toplevel)"
sha="$(git -C "$root" rev-parse HEAD)"
out="$root/.verify/$sha.md"
summary="${1:?usage: record.sh \"<what was verified>\"}"
{
  echo "# verify $sha"
  echo
  echo "- date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "- summary: $summary"
  echo "- dirty files: $(git -C "$root" status --porcelain | wc -l | tr -d ' ')"
  echo
  echo "## calls"
  echo
  echo '```'
  cat "$root/.verify/run/calls.log"
  echo '```'
} > "$out"
echo "wrote $out"
