---
name: verify-run-budget
description: Check that the run budget (tool rounds, tokens, cost, elapsed time) stops each D1Agents run exactly at the first tool round that reaches a limit, counting only that run. Use when a change touches src/infra/pi/extensions/budget.ts, src/domain/budget.ts, how PiAgent installs the budget extension or submits events, or after upgrading @earendil-works/pi-durable.
---

# 1 回の実行の予算上限を確かめる

## 守っている約束

- 約束:1 回の実行(イベント 1 件で始まる run)は、その run で使った量が上限に届いたツール往復の直後に、`app.budget` の記録を 1 件だけ残して止まる。前の run の使用量は数えない
- 破れたときの害:止まらなければモデルの利用料が上限なしに増える。早く止まれば、利用者の依頼が途中で切られ、まちがった理由が残る

## 性質(`src/tests/budget-scenarios.verify.ts` の `budgetViolations`)

ログを `pi.user` の位置で run に分け、run ごとに次を確かめます。

| 性質               | 内容                                                                                                    | 反例の書き出し                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 届いたら止まる     | ツール往復 `n` 回目の終わりで、往復数 `≥ turns` かトークン合計 `≥ tokens` なら、次の記録が `app.budget` | `round n reached … but the next entry is …`               |
| 止まったら呼ばない | `app.budget` の後に、同じ run でモデルを呼ばない                                                        | `model called again after the round that reached a limit` |
| 届く前は止めない   | 上限に届いていない run に `app.budget` がない                                                           | `stopped at entry …`                                      |
| 1 回だけ           | 1 つの run に `app.budget` は 1 件まで                                                                  | `… budget entries`                                        |

トークン合計は、その run の `pi.assistant` の `usage.totalTokens` を検査側で数え直したものです。拡張の `run.first` とは別の方法(`pi.user` での区切り)で run を決めるので、「前の run を数える」ずれを見つけられます。

## 確かめ方と範囲

TypeScript のコードと pi-durable の内部にそのままかけられる検証器はないので、本物の拡張と本物の pi-durable を workerd 上で動かし、台本どおりに動く偽のモデルで、決めた範囲の実行パターンを全部試します。TLA+ にしないのは、Durable Object が `runtime.commit` を 1 つずつ順に処理し、アプリは `whenBusy: "followUp"` でしか送らないので、調べるべき割り込みの順番がないからです。危ないのは pi-durable の数え方(`startRun`、`run.turns`、`run.first`)で、手で写したモデルはすぐに古くなります。

- 範囲:台本 8 種(ツール往復 0〜3 回 × 最後が答えかモデルエラー)の 1 件と 2 件の並び。2 件目は「1 件目が終わってから送る」と「1 件目の実行中に `wait=false` で積む」の 2 通り。上限 10 組(turns 1・2・3、tokens 1・10,000・15,000・25,000、turns 2 と tokens 10,000、上限なし)。合計 1,360 通り
- 検査が失敗できること:`bun run verify:budget -- --mutants` が、わざと壊した 5 つの版(run ではなくセッション全体を数える、止めても run が続く、往復数を 1 少なく数える、最後の呼び出しのトークンだけ数える、`≥` を `>` にする)をそれぞれ検出することを確かめる
- 範囲外
  - 費用(`costUsd`)と経過時間(`elapsedMs`):偽のモデルは費用が常に 0、時刻は実時間なので、全パターンの中では上限なしにしている。数え方の単体テストは `src/tests/budget.test.ts`
  - モデルの再試行(本番は `maxRetries: 5`):`maxRetries: 2` で失敗する台本を流すとログの `pi.assistant` は 1 件だけだった。再試行が起きたのか、起きてもログに残らないのかは確かめていない。どちらにせよ予算はログしか見ないので、再試行の分は数えない
  - 会話の圧縮(compaction)の使用量、`steer` と `continue`(アプリは使っていない)
  - ログの 1 ページ(100 件)を超える長い run。範囲内の run は 10 件以下なので、`runUsage` のページ送りは通っていない

## 見つけたこと(コードは変えていない)

| 内容                                                                                  | 害                                                                                           |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `wait=false` で積んだイベントは、それぞれ新しい run になり、予算が 0 から数え直される | セッション全体の支出には上限がない。1 件ごとの上限という設計どおりだが、積まれた数だけ使える |
| 予算の確認はツール往復の後にしか動かない                                              | ツールを使わない run と、モデルの再試行は確認されない。1 回の呼び出しは上限を越えうる        |
| フックが例外を投げると報告だけされ、run は続く                                        | 予算を読めないときは止めない側に倒れる                                                       |

## 手順

1. 変更が下の「対象のコード」に触れるか確かめる。`git diff <同期コミット> -- src/infra/pi/extensions/budget.ts src/domain/budget.ts src/application/pi-agent.ts src/infra/pi/run-event.ts package.json`(`package.json` は `@earendil-works/pi-durable` の版を見るため)
2. 検査を流す(約 1 分半):

   ```sh
   bun run verify:budget
   ```

3. 結果を読む
   - 通る:約束は範囲の中で保たれている
   - 落ちる:最初の 10 件の反例が `{"runs":[…],"delivery":…,"limits":…} -> run 2: …` の形で出る。台本の並びと上限を、利用者が送ったイベントの順番として読み、どの往復で止まるべきだったかを確かめる。本物のバグなので、性質や範囲をゆるめずに直す
   - すべての台本で同じ反例が出る、または `pi.user` の位置がずれる:pi-durable の記録の形(`pi.user`・`pi.tool-result`・`pi.assistant` の並び)が変わった可能性がある。`src/tests/worker.ts` の `transcript` で実際の並びを見て、検査側の区切り方を直す
4. 検査そのものを直したとき、または対象のコードを意図して変えたときは、壊した版を流す(約 8 分):

   ```sh
   bun run verify:budget -- --mutants
   ```

   `caught` 以外の行があれば検査が弱い。`stale` はその版の置き換え元がコードから消えたという意味なので、`scripts/verify/budget.ts` の `MUTANTS` を今のコードに合わせる

5. 上限の種類を足したら、`src/tests/budget-scenarios.verify.ts` の `LIMITS` と `runViolations`、壊した版、この SKILL.md の表を同じ変更で直す

## 対象のコードと同期コミット

| 検査           | 対象                                                                                                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 数え方と止め方 | `src/infra/pi/extensions/budget.ts` の `createBudgetExtension`、`runUsage`、`BudgetStop`                                                                             |
| 上限の判定     | `src/domain/budget.ts` の `overBudget`、`RUN_BUDGET`                                                                                                                 |
| 呼び出し側     | `src/application/pi-agent.ts` の `createBudgetExtension(() => RUN_BUDGET)`、`src/infra/pi/run-event.ts` の `submit` と `prompt`(`whenBusy` を指定しない)             |
| 前提           | `@earendil-works/pi-durable` 1.6 の `startRun`・`run.turns`・`run.first`、`afterTools` の `terminate` が final 境界で run を終えること(`dist/harness/generation.js`) |
| 台本と記録     | `src/tests/worker.ts` の `planned`、`transcript`、`submit`、`busy`                                                                                                   |

- 同期コミット:46f380a4d8d594dec526053320d2f0b2413fe167(PR #44 の予算上限のコミット)
- 対象のコードが変わったら、上の手順で検査が今のコードを表していると確かめてから、同期コミットを進める。確かめていないのに進めない
