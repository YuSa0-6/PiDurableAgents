#!/bin/sh
set -u
root="$(git rev-parse --show-toplevel)"
run="$root/.verify/run"
ok=0
if [ -f "$run/pid" ] && kill -0 "$(cat "$run/pid")" 2>/dev/null; then
  echo "process: ok (pid $(cat "$run/pid"), started by launch.sh)"
else
  echo "process: not running. run launch.sh"
  ok=1
fi
port="$(cat "$run/port" 2>/dev/null || true)"
if [ -n "$port" ]; then
  health="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$port/api/health" || true)"
  echo "/api/health without a token: $health (want 200 in verify mode)"
  [ "$health" = "200" ] || ok=1
else
  echo "port: unknown"
  ok=1
fi
for name in CLOUDFLARE_ACCESS_CLIENT_ID CLOUDFLARE_ACCESS_CLIENT_SECRET; do
  eval "value=\${$name:-}"
  [ -n "$value" ] || { echo "$name: missing (remote AI and Artifacts will be blocked by Access)"; ok=1; }
done
echo "commit: $(git -C "$root" rev-parse HEAD)"
exit $ok
