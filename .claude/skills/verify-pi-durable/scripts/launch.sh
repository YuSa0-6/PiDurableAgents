#!/bin/sh
set -eu
root="$(git rev-parse --show-toplevel)"
run="$root/.verify/run"
mkdir -p "$run"
if [ -f "$run/pid" ] && kill -0 "$(cat "$run/pid")" 2>/dev/null; then
  echo "already running: pid $(cat "$run/pid"), port $(cat "$run/port")"
  exit 0
fi
: > "$run/calls.log"
cd "$root"
nohup bun run start > "$run/dev.log" 2>&1 &
echo $! > "$run/pid"
i=0
while [ $i -lt 120 ]; do
  port="$(grep -oE 'localhost:[0-9]+' "$run/dev.log" | head -1 | cut -d: -f2 || true)"
  if [ -n "$port" ]; then
    code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$port/api/health" || true)"
    if [ "$code" = "200" ] || [ "$code" = "401" ]; then
      echo "$port" > "$run/port"
      echo "ready: http://localhost:$port (pid $(cat "$run/pid"))"
      exit 0
    fi
  fi
  if ! kill -0 "$(cat "$run/pid")" 2>/dev/null; then
    echo "cf dev exited. last lines of $run/dev.log:" >&2
    tail -20 "$run/dev.log" >&2
    exit 1
  fi
  i=$((i + 1))
  sleep 1
done
echo "cf dev did not answer within 120s. see $run/dev.log" >&2
exit 1
