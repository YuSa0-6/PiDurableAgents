# 構成図：現状と期待値

D1Agents の「いまの構成」と「目指す構成（案）」を並べた図です。図は [stack-diagram](https://github.com/caru-ini/stack-diagram) で作りました。2 枚の図は、同じ部品を同じ位置に置いています。期待値の図で役割の先頭に「＋」があるものが、新しく足す部分です。

| ファイル | 内容 |
| --- | --- |
| `current.html` / `current.png` / `current-dark.png` | 現状 |
| `target.html` / `target.png` / `target-dark.png` | 期待値（案） |

HTML はフォントとロゴを埋め込んだ 1 ファイルなので、ネットワークなしでブラウザで開けます。PNG は HTML をそのまま撮ったものです。

## 現状

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="current-dark.png">
  <img src="current.png" alt="現状の構成図：開発者が認証なしの HTTP で Cloudflare の Worker（Hono の Event Router）に送る。Router は DecisionModel に判定させ（d1.1 は AI Gateway 経由）、RPC で Durable Object の Pi Durable に渡す。Pi Durable は AI Gateway から OpenRouter のモデルを呼び、Workspace のツールを使う。Workspace は Dynamic Worker で JavaScript を実行し、GitHub から clone だけできる" width="100%">
</picture>

## 期待値（案）

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="target-dark.png">
  <img src="target.png" alt="期待値の構成図：現状に加えて、CLI と評価ランナーが同じ API を認証付きの HTTP と SSE で使う。Pi Durable にガードとサブエージェント、Dynamic Worker に bash、GitHub に push、任意で Container による npm test を足す" width="100%">
</picture>

## 現状と期待値の比較

「状態」の意味：

| 状態 | 意味 |
| --- | --- |
| 済 | もう動いている |
| 決定 | やることは決まっている。中身はこれから決める |
| 案 | 提案の段階。やるかどうか、やり方も含めて未定 |

| 分野 | 現状 | 期待値 | 状態 |
| --- | --- | --- | --- |
| 入口 | `curl` と Webhook（`POST /api/events`） | CLI（chat / send / log）と評価ランナーが同じ API を使う | 案 |
| 認証 | なし（URL を知っていれば誰でも呼べる） | Bearer トークン。Worker の secret に置く | 案 |
| API | `/api/events`、`/api/decide`、判定ログ | セッション単位の prompt / stream（SSE）/ messages / abort | 案 |
| API 設計の進め方 | ー | 試作で Pi の実データを見てから、イベントの形を `docs/api.md` に決める | 決定 |
| モデル選択 | DecisionModel（ガード + d1.1）→ OpenRouter の 5 モデル | 変えない | 済 |
| 会話の永続化 | Pi Durable が Durable Object の SQLite に保存 | 変えない | 済 |
| ハーネスの制御 | 再実行してよいツールだけを指定 | 危険な操作のガード（`hook` / `wrapTool`）、コーディング向けの要約設定 | 案 |
| 分担 | 1 つのエージェントだけ | 調査役などのサブエージェント | 案 |
| ファイル操作 | read / write / edit / ls / find / grep | 変えない | 済 |
| コード実行 | `exec`（JavaScript のみ、通信なし） | `exec` を順番に実行し、bash（`WorkerShellBackend`、just-bash）を足す | 案 |
| 本物の Linux | なし | Container で `npm install` / `npm test`（任意・費用あり） | 案 |
| git | clone / status / diff / log | commit と push。GitHub の認証方法は未定 | 案 |
| 品質の測定 | 単体テスト 8 件 | 小さなコーディング課題で成功率・コスト・時間を記録 | 案 |
| デプロイ | 手元から `wrangler deploy` | 変えない | 済 |

## 図を作り直すとき

1. stack-diagram のスキル（`npx skills add caru-ini/stack-diagram`）を入れる
2. `current.html` / `target.html` の NODES・GROUPS・EDGES を書き換える。座標のルールはスキルの `references/geometry.md` にあります
3. スキルの `scripts/render_png.py` で、ライトとダークの PNG を作り直す

日本語を含むので、PNG を作る環境には日本語フォント（Noto Sans JP など）が必要です。
