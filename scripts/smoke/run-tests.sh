#!/bin/sh
set -eu

base_url="${SMOKE_BASE_URL:-https://d1agents-pi-durable.itumens.workers.dev}"
session="${SMOKE_SESSION:-smoke-$(date +%s)}"

if [ -z "${CLOUDFLARE_ACCOUNT_TOKEN:-}" ]; then
  echo "CLOUDFLARE_ACCOUNT_TOKEN がありません。リポジトリの Actions シークレットに入れてください。" >&2
  exit 1
fi

text='/workspace/demo に package.json を作って、scripts.test を "node --test" にしてください。同じ場所に、1+1 が 2 になることを node:test と node:assert で確かめる test.mjs を作ってください。そのあと run_tests で dir=/workspace/demo、script=test を実行し、ツールが返した文章の 1 行目だけを、そのまま返してください。'
body=$(jq -n --arg session "$session" --arg text "$text" '{session: $session, text: $text}')

set -- -sS --max-time 600 -X POST "$base_url/api/events" \
  -H "authorization: Bearer $CLOUDFLARE_ACCOUNT_TOKEN" \
  -H 'content-type: application/json'
if [ -n "${CF_ACCESS_CLIENT_ID:-}" ]; then
  set -- "$@" -H "cf-access-client-id: $CF_ACCESS_CLIENT_ID" -H "cf-access-client-secret: ${CF_ACCESS_CLIENT_SECRET:-}"
fi

echo "session: $session"
response=$(curl -w '\n%{http_code}' "$@" --data "$body") || {
  echo "Worker に届きませんでした(curl が失敗しました)。" >&2
  exit 1
}
status=$(printf '%s\n' "$response" | tail -n 1)
reply=$(printf '%s\n' "$response" | sed '$d')
echo "HTTP $status"
printf '%s\n' "$reply"

if [ "$status" != "200" ]; then
  echo "Worker が 200 以外を返しました。" >&2
  exit 1
fi
if printf '%s' "$reply" | jq -e '.result.status == "done" and (.result.text | test("run test passed with exit code 0"))' >/dev/null 2>&1; then
  echo "run_tests はコンテナでテストを通しました。"
  exit 0
fi
echo "返事に 'run test passed with exit code 0' がありません。上の返事を確かめてください。" >&2
exit 1
