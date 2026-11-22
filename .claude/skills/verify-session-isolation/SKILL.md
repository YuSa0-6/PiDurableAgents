---
name: verify-session-isolation
description: Check that every D1Agents session gets its own Cloudflare Artifacts namespace (artifactsSessionId stays injective, prefix-free and accepted by Artifacts). Use when a change touches src/domain/artifacts-session-id.ts, src/domain/session-id.ts, how PiAgent passes sessionId to the Workspace, or after upgrading @cloudflare/computer.
---

# セッションごとの Artifacts の分離を確かめる

## 守っている約束

- 約束:あるセッションのエージェントは、自分のセッションの Artifacts リポジトリだけを見て、読み、push できる
- 破れたときの害:別のセッション(別の利用者や別の作業)のリポジトリが一覧に出る、読める、上書きされる

`@cloudflare/computer` はリポジトリを 1 つの namespace `d1agents` に `<sessionId>__<リポジトリ名>` の名前で保存し、一覧は `<sessionId>__` の接頭辞で絞ります(`node_modules/@cloudflare/computer/dist` で `function scopedName` を検索)。リポジトリ名は英数字で始まり `__` を含みません。そのため次の性質が成り立てば、保存名の最初の `__` が必ず区切りになり、セッションが混ざりません。

## 性質(`src/domain/artifacts-session-id.test.ts` の `counterexample`)

| 性質   | 内容                                                                                            | 反例の書き出し |
| ------ | ----------------------------------------------------------------------------------------------- | -------------- |
| 分離   | 違うセッション名が同じ ID にならない                                                            | `isolated:`    |
| 接頭辞 | ID は `_` で終わらず `__` を含まない                                                            | `prefix-free:` |
| 受理   | ID は `/^[A-Za-z0-9][A-Za-z0-9._-]*$/` に合い、`..` を含まず、長さは `3 + 文字数 + _ の数` 以下 | `accepted:`    |
| 安定   | そのまま受け付けられる名前(英数字で始まる、`__` なし、`_` で終わらない)は変えない               | `stable:`      |
| 閉包   | SessionId でない値は `InvalidInput`                                                             | (個別のテスト) |

## 確かめ方と範囲

TypeScript のコードに直接かけられる検証器はこの環境にないので、本物の関数に全パターンを通す「範囲を区切った全数検査」にしています。SMT で書くと 2 つの置き換えを手で写すことになり、コードからずれるので使いません。

- 範囲:文字 `{a, s, x, u, 0, _, -}` で作れる長さ 1〜6 のすべての名前と、長さ 64 の 3 件(`_`×64、`-`+`a`×63、`a`×64)。合計 137,259 件。`x` と `u` は置き換えに使う文字なので必ず入れる
- 検査が失敗できること:同じファイルで、わざと壊した 6 つの版(以前の規則、`_` 終わりを残す、`_`→`-`、そのままの ID と同じ綴りになる置き換え、`_`→`.`、常に置き換える)がそれぞれ反例を出すことを確かめている
- 範囲外:Artifacts 本体の名前の制限(2026-11-22 に `s.x.ua__probe` と 196 文字の名前が通ることを API で確認済み)、`workspacePath`、`requireAgentBranch`、Durable Object の名前の付け方

## 手順

1. 変更が下の「対象のコード」に触れるか確かめる。`git diff <同期コミット> -- src/domain/artifacts-session-id.ts src/domain/session-id.ts src/application/pi-agent.ts`
2. 検査を流す(1 秒以内):

   ```sh
   bun run test src/domain/artifacts-session-id.test.ts
   ```

3. 結果を読む
   - すべて通る:約束は範囲の中で保たれている
   - 1 件目の `it`(本物の関数)が落ちる:反例(`isolated: _ and - both map to s.x-` など)を、2 つのセッションが同じリポジトリを共有する手順として読む。本物のバグなので、性質や範囲をゆるめずに直す
   - 「finds the break in …」が落ちる:検査が壊れた版を見逃している。検査の文字集合か性質が弱くなっているので、検査のほうを直す
   - `maps … to …` だけが落ちる:規則を意図して変えたなら、例の表と、本番の namespace に残るリポジトリの移し替えを考える(既存の ID が変わると、そのセッションのリポジトリは見えなくなる)
4. 規則を意図して変えたときは、壊した版の一覧と、この SKILL.md の表を同じ変更で直す。新しい置き換えに使う文字を `ALPHABET` に足す

## 対象のコードと同期コミット

| 検査       | 対象                                                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| 5 つの性質 | `src/domain/artifacts-session-id.ts` の `artifactsSessionId`、`src/domain/session-id.ts` の `isSessionId`                  |
| 呼び出し側 | `src/application/pi-agent.ts` の `Workspace` の `artifacts.sessionId`(`this.ctx.id.name ?? this.ctx.id.toString()` を渡す) |
| 前提       | `@cloudflare/computer` の `scopedName` と `unscopedName`(`<sessionId>__<name>`、接頭辞での一覧)                            |

- 同期コミット:802f53c158a172e33c5cacaf70eb658e9587261c(PR #31 のマージ)
- 対象のコードが変わったら、上の手順で検査が今のコードを表していると確かめてから、同期コミットを進める。確かめていないのに進めない
- `@cloudflare/computer` を上げたら、`scopedName` の形と名前の規則が変わっていないか読む
