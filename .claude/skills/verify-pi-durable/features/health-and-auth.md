# 動作確認と認証

## Sub-features

- トークンなしは 401
- 正しいアカウント API トークンで 200 と、使っているモデル

## How to get to it (user POV)

`/api/*` を `Authorization: Bearer <アカウント API トークン>` 付きで呼ぶ。

## Driving it with curl

```sh
S=.claude/skills/verify-pi-durable/scripts
curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:$(cat .verify/run/port)/api/health"
sh $S/call.sh GET /api/health
```

合格:1 行目が `401`、2 行目が `status: 200` で、JSON にモデル名がある。

## Gotchas

- 認証は Cloudflare API への問い合わせなので、ネットワークがない環境では 200 にならない
