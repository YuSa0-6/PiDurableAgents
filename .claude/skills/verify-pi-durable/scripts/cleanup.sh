#!/bin/sh
set -u
root="$(git rev-parse --show-toplevel)"
run="$root/.verify/run"
if [ -f "$run/pid" ]; then
  pid="$(cat "$run/pid")"
  if kill -0 "$pid" 2>/dev/null; then
    pkill -TERM -P "$pid" 2>/dev/null || true
    kill -TERM "$pid" 2>/dev/null || true
    echo "stopped pid $pid"
  fi
  rm -f "$run/pid" "$run/port"
fi
echo "evidence kept in $root/.verify/"
