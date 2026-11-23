#!/bin/sh
set -eu
root="$(git rev-parse --show-toplevel)"
run="$root/.verify/run"
port="$(cat "$run/port")"
base="http://localhost:$port"
send() {
  if [ -n "${CLOUDFLARE_ACCOUNT_TOKEN:-}" ]; then
    curl -H "authorization: Bearer $CLOUDFLARE_ACCOUNT_TOKEN" "$@"
  else
    curl "$@"
  fi
}
method="$1"
target="$2"
body="${3:-}"
log="$run/calls.log"
{
  echo "### $method $target"
  [ -n "$body" ] && echo "body: $body"
} >> "$log"
if [ "$method" = "MCP" ]; then
  params="$body"
  [ -n "$params" ] || params="{}"
  payload="{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$target\",\"params\":$params}"
  response="$(send -s -w '\nstatus: %{http_code}' -X POST "$base/mcp" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d "$payload")"
elif [ -n "$body" ]; then
  response="$(send -s -w '\nstatus: %{http_code}' -X "$method" "$base$target" -H 'content-type: application/json' -d "$body")"
else
  response="$(send -s -w '\nstatus: %{http_code}' -X "$method" "$base$target")"
fi
token_pattern="$(printf '%s' "${CLOUDFLARE_ACCOUNT_TOKEN:-__none__}" | sed 's/[][\.*^$/]/\\&/g')"
redacted="$(printf '%s\n' "$response" | sed -E "s/$token_pattern/<redacted>/g; s/(\"token\"[[:space:]]*:[[:space:]]*\")[^\"]+/\1<redacted>/g")"
printf '%s\n\n' "$redacted" >> "$log"
printf '%s\n' "$redacted"
