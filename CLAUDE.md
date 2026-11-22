# D1Agents

## 層と依存のルール

`src/` は 4 つの層に分かれます。import は外側から内側への一方向だけです。`bun run check` が `lint/clean-architecture.js` で確かめます。

| 層                 | 置くもの                                                                    | import してよい層      |
| ------------------ | --------------------------------------------------------------------------- | ---------------------- |
| `src/domain/`      | ルールと型。外部ライブラリ、`Date`・`crypto`・`fetch`・`console` は使わない | domain                 |
| `src/usecase/`     | ユースケースと `ports/`(interface と type だけ)                             | domain, usecase        |
| `src/infra/`       | ports の実装、pi 拡張、LLM の設定                                           | domain, usecase, infra |
| `src/application/` | Worker の入口、HTTP・MCP、Durable Object、部品の組み立て                    | すべて                 |

- 時刻・ID・通信が必要なユースケースは、ports にインターフェースを足し、infra に実装を置き、`application/compose.ts` でつなぐ
- テストは対象の隣に `*.test.ts` で置く。Worker 全体を通すテストは `src/tests/`

## 書き方

- コメントは書かない。名前と型で意図を伝える(`@ts-` や `oxlint-` などの指示コメントだけ許す)
- 動きを変える変更の前に、`src/tests/http-contract.test.ts` が通ることを確かめる

## コマンド

| 目的                           | コマンド                                          |
| ------------------------------ | ------------------------------------------------- |
| インストール                   | `bun install`                                     |
| 整形・リント・型チェック(tsrs) | `bun run check`(直すときは `bunx vp check --fix`) |
| 型チェックだけ                 | `bun run typecheck`                               |
| テスト(workerd 上)             | `bun run test`                                    |
| ローカル起動                   | `bun run start`                                   |
| デプロイ                       | `bun run deploy`(本番に出るので確認してから)      |

`cf` は Bun 上では `cloudflare.config.ts` を読めません。`bun run` と `bunx` は Node.js で動かすので、そのまま使えます。`bun --bun` は使いません。

## マージ前の検証

git フック(`.vite-hooks/`)、Claude Code のフック(`.claude/settings.json`)、CI(`.github/workflows/`)が自動で動きます。置き場所の一覧は README の「マージ前の検証」にあります。

- 作業を終えるとき、コードを変えていれば Stop フックが `vp check` とテストを流す。失敗したら直してから終える
- PR を作る前に実アプリで確かめ、実行したコマンドと結果を `.verify/<HEAD の SHA>.md` に書く。ないと PR 作成のフックが止める
