#!/bin/sh
set -eu
bun run build > /dev/null
config=.cloudflare/output/v0/workers/default/worker.config.json
if grep -q SKIP_AUTH_ON_LOCALHOST "$config"; then
  echo "SKIP_AUTH_ON_LOCALHOST is in $config. Deploy builds must not use --mode verify." >&2
  exit 1
fi
echo "deploy build has no local auth bypass"
