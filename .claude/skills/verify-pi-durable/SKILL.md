---
name: verify-pi-durable
description: Drive the D1Agents Pi Durable Worker the way a user does (cf dev, then HTTP /api/* and remote MCP /mcp with an account API token) and record evidence in .verify/<sha>.md. Use before opening a PR, after any change under src/ or the Worker config, or when asked to prove a feature works in the real app.
---

# D1Agents を実アプリで確かめる

`cf dev` で Worker を起動し、利用者と同じように HTTP と MCP で呼び、結果を `.verify/<HEAD の SHA>.md` に残します。PR 作成のフック(`.claude/hooks/before-pr.ts`)はこの記録を探します。

## 前提

| 必要なもの              | 確かめ方                              | ないとき                                                                                                                       |
| ----------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Cloudflare の認証       | `cf dev` が起動する                   | `CLOUDFLARE_API_TOKEN` を入れるか `bunx cf auth login`。AI と Artifacts は `dev.remote: true` なので、ローカルだけでは動かない |
| アカウント API トークン | `CLOUDFLARE_ACCOUNT_TOKEN` が空でない | ダッシュボードの Manage Account → Account API Tokens で作る。Worker は `/accounts/<ACCOUNT_ID>/tokens/verify` で確かめる       |
| 依存                    | `node_modules` がある                 | `bun install`                                                                                                                  |

認証がない環境(ネットワーク制限のあるクラウドなど)では起動できません。そのときは「未検証」と記録に書き、検証できる環境で走らせます。テストやモックの結果で代わりにしません。

## 手順

1. **Launch**:`sh .claude/skills/verify-pi-durable/scripts/launch.sh`。`.verify/run/` に PID・ポート・ログを置き、`/api/health` が 401 か 200 を返すまで待ちます(最大 120 秒)
2. **Doctor**:`sh .claude/skills/verify-pi-durable/scripts/doctor.sh`。自分が起動したプロセスか、ポートが答えるか、トークンで 200 が返るかを見ます。おかしいと感じたら最初にこれを流します
3. **Drive**:変えた機能に合う手順を [features/README.md](features/README.md) から選んで流します。呼び出しは `scripts/call.sh` を使います
4. **Evidence**:`sh .claude/skills/verify-pi-durable/scripts/record.sh "<確かめたこと>"` が `.verify/<sha>.md` を作り、`.verify/run/calls.log`(実行したコマンドとレスポンス)を写します
5. **Cleanup**:`sh .claude/skills/verify-pi-durable/scripts/cleanup.sh`。自分が起動した PID だけを止めます。`.verify/<sha>.md` は残します

## 証拠の基準

- 利用者と同じ入口(`/api/*`、`/mcp`)を通す。テスト用の Durable Object や内部関数を直接呼ばない
- 呼び出しと、その結果の状態(返答、会話ログ、Artifacts のリポジトリ)の両方を残す
- `wait: false` の依頼は、あとで同じ `session` の結果を確かめるまで合格にしない
- 失敗した手順は弱めずに失敗として書き、理由を該当する feature の Gotchas に足す

## 呼び出しの例

```sh
S=.claude/skills/verify-pi-durable/scripts
sh $S/call.sh GET /api/health
sh $S/call.sh POST /api/events '{"session":"verify","text":"/workspace/hello.txt に hello と書いて読み返して"}'
sh $S/call.sh GET /api/sessions/verify/repos
sh $S/call.sh MCP tools/list
sh $S/call.sh MCP tools/call '{"name":"send_event","arguments":{"session":"verify","text":"hello.txt を読んで"}}'
```
