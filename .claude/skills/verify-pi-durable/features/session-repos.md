# 成果のリポジトリ

## Sub-features

- セッションの Artifacts リポジトリと、1 時間有効な読み取り専用トークン
- おかしなセッション名は 400

## How to get to it (user POV)

`GET /api/sessions/<session>/repos`。返ったトークンで `git clone` できる。

## Driving it with curl

```sh
S=.claude/skills/verify-pi-durable/scripts
bun $S/call.ts POST /api/events '{"session":"verify","text":"artifacts にリポジトリ notes を作って hello.txt を agent/verify ブランチに commit して push して"}'
bun $S/call.ts GET /api/sessions/verify/repos
bun $S/call.ts GET '/api/sessions/bad%20name/repos'
```

合格:2 つ目の返答に `notes` があり、`status: 200`。3 つ目は `status: 400`。記録のトークンは `<redacted>` になっている。

## Gotchas

- `call.ts` は記録に残す前にトークンを伏せる。clone まで確かめるときは、返答のトークンを記録に書かない
