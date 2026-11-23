# 動作確認と認証

## Sub-features

- verify モードの localhost は、トークンなしで 200 と使っているモデル
- 本番と同じトークンの確認(401 と 200)は `src/tests/http-contract.test.ts` が workerd 上で確かめる

## How to get to it (user POV)

本番では `/api/*` を `Authorization: Bearer <アカウント API トークン>` 付きで呼ぶ。verify モードの localhost ではヘッダーなしで呼べる。

## Driving it with curl

```sh
S=.claude/skills/verify-pi-durable/scripts
bun $S/call.ts GET /api/health
```

合格:`status: 200` で、JSON にモデル名がある。

## Gotchas

- `bun run start`(モードなし)で起動したときは、トークンなしは 401 になる
