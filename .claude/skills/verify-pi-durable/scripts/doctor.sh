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
  anon="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$port/api/health" || true)"
  echo "unauthenticated /api/health: $anon (want 401)"
  [ "$anon" = "401" ] || ok=1
else
  echo "port: unknown"
  ok=1
fi
if [ -z "${CLOUDFLARE_ACCOUNT_TOKEN:-}" ]; then
  echo "CLOUDFLARE_ACCOUNT_TOKEN: missing"
  ok=1
elif [ -n "$port" ]; then
  authed="$(curl -s -o /dev/null -w '%{http_code}' -H "authorization: Bearer $CLOUDFLARE_ACCOUNT_TOKEN" "http://localhost:$port/api/health" || true)"
  echo "authenticated /api/health: $authed (want 200)"
  [ "$authed" = "200" ] || ok=1
fi
echo "commit: $(git -C "$root" rev-parse HEAD)"
exit $ok
