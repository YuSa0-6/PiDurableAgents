# リモート MCP

## Sub-features

- `tools/list` に `send_event`、`session_repos`、`health`
- `tools/call` が HTTP と同じ処理に届く(会話ログの `source` が `mcp`)
- OPTIONS は通る(本番のトークンなし 401 はテストが確かめる)

## How to get to it (user POV)

リモート MCP コネクタから `https://<host>/mcp` に静的な Authorization ヘッダー付きでつなぐ。

## Driving it with curl

```sh
S=.claude/skills/verify-pi-durable/scripts
sh $S/call.sh MCP initialize '{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"verify","version":"0"}}'
sh $S/call.sh MCP tools/list
sh $S/call.sh MCP tools/call '{"name":"send_event","arguments":{"session":"verify","text":"hello.txt の中身を教えて"}}'
curl -s -o /dev/null -w '%{http_code}\n' -X OPTIONS "http://localhost:$(cat .verify/run/port)/mcp"
```

合格:`tools/list` に 3 つのツール名、`tools/call` の結果に `hello`、OPTIONS は 2xx。

## Gotchas

- サーバーはステートレスなので、`initialize` を飛ばして `tools/list` を呼んでも答える
