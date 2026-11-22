#!/bin/sh
set -eu

if command -v zizmor >/dev/null 2>&1; then
  exec zizmor --offline "$@" .
fi
if command -v uvx >/dev/null 2>&1; then
  exec uvx zizmor@1.32.0 --offline "$@" .
fi
echo "zizmor も uvx も見つからないので GitHub Actions の検査を飛ばします(CI では必ず実行されます)。" >&2
echo "入れ方: brew install zizmor / uv tool install zizmor" >&2
exit 0
