---
name: verify-pi-durable
description: Drive the D1Agents Pi Durable Worker the way a user does (cf dev in verify mode, then HTTP /api/* and remote MCP /mcp from localhost without a token) and record evidence in .verify/<sha>.md. Use before opening a PR, after any change under src/ or the Worker config, or when asked to prove a feature works in the real app.
---

# D1Agents を実アプリで確かめる

`cf dev` で Worker を起動し、利用者と同じように HTTP と MCP で呼び、結果を `.verify/<HEAD の SHA>.md` に残します。PR 作成のフック(`.claude/hooks/before-pr.ts`)はこの記録を探します。

## 前提

`launch.ts` は `cf dev --mode verify` で起動します。verify モードでは `cloudflare.config.ts` が `SKIP_AUTH_ON_LOCALHOST=1` を足し、localhost から来た呼び出しだけトークンなしで通します。本番のデプロイ(モードなし)にはこの値が入らず、localhost 以外のホストは verify モードでもトークンが要ります(`src/tests/http-contract.test.ts` が確かめます)。トークンの確認そのものはテストが受け持ちます。

| 必要なもの                | 確かめ方                                                                      | ないとき                                                                                                                                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare の認証         | `cf dev` が起動する                                                           | `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` を入れるか `bunx cf auth login`。AI と Artifacts は `dev.remote: true` なので、ローカルだけでは動かない                                                   |
| Access のサービストークン | `CLOUDFLARE_ACCESS_CLIENT_ID` と `CLOUDFLARE_ACCESS_CLIENT_SECRET` が空でない | `*.workers.dev` が Cloudflare Access の後ろにあるので、AI と Artifacts のリモート接続に要る。ないと `send_event` は `model_error`、repos は 500 になる。対話できる端末なら `cloudflared` のログインでもよい |
| 依存                      | `node_modules` がある                                                         | `bun install`                                                                                                                                                                                               |

プロキシが `api.cloudflare.com` に認証を差し込むクラウド環境では、`CLOUDFLARE_API_TOKEN` はダミーの値で起動できます。Access のサービストークンは workerd とリモートの間で使われるので、本物の値が要ります。足りない手順は「未検証」と記録に書き、検証できる環境で走らせます。テストやモックの結果で代わりにしません。

## 手順

1. **Launch**:`bun .claude/skills/verify-pi-durable/scripts/launch.ts`。`.verify/run/` に PID・ポート・ログを置き、`/api/health` が 200 を返すまで待ちます(最大 120 秒)
2. **Doctor**:`bun .claude/skills/verify-pi-durable/scripts/doctor.ts`。自分が起動したプロセスか、トークンなしの `/api/health` が 200 か、Access の変数があるかを見ます。おかしいと感じたら最初にこれを流します
3. **Drive**:変えた機能に合う手順を [features/README.md](features/README.md) から選んで流します。呼び出しは `scripts/call.ts` を使います
4. **Evidence**:`bun .claude/skills/verify-pi-durable/scripts/record.ts "<確かめたこと>"` が `.verify/<sha>.md` を作り、`.verify/run/calls.log`(実行したコマンドとレスポンス)を写します
5. **Cleanup**:`bun .claude/skills/verify-pi-durable/scripts/cleanup.ts`。自分が起動した PID だけを止めます。`.verify/<sha>.md` は残します

## 証拠の基準

- 利用者と同じ入口(`/api/*`、`/mcp`)を通す。テスト用の Durable Object や内部関数を直接呼ばない
- 呼び出しと、その結果の状態(返答、会話ログ、Artifacts のリポジトリ)の両方を残す
- `wait: false` の依頼は、あとで同じ `session` の結果を確かめるまで合格にしない
- 失敗した手順は弱めずに失敗として書き、理由を該当する feature の Gotchas に足す

## 呼び出しの例

```sh
S=.claude/skills/verify-pi-durable/scripts
bun $S/call.ts GET /api/health
bun $S/call.ts POST /api/events '{"session":"verify","text":"/workspace/hello.txt に hello と書いて読み返して"}'
bun $S/call.ts GET /api/sessions/verify/repos
bun $S/call.ts MCP tools/list
bun $S/call.ts MCP tools/call '{"name":"send_event","arguments":{"session":"verify","text":"hello.txt を読んで"}}'
```
