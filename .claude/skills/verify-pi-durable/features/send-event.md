# エージェントへの依頼

## Sub-features

- 返答を待つ依頼(`wait` 省略)
- 同じ `session` で会話とファイルが続く
- 同じ `id` は 1 回だけ処理される
- 入力の誤りは 400

## How to get to it (user POV)

`POST /api/events` に `{"session","text"}` を送る。MCP の `send_event` も同じ処理を通る。

## Driving it with curl

```sh
S=.claude/skills/verify-pi-durable/scripts
sh $S/call.sh POST /api/events '{"session":"verify","text":"/workspace/hello.txt に hello と書いて保存し、読み返して"}'
sh $S/call.sh POST /api/events '{"session":"verify","text":"さっき保存したファイルの中身を教えて"}'
sh $S/call.sh POST /api/events '{"session":"verify","id":"dup-1","text":"1 と答えて"}'
sh $S/call.sh POST /api/events '{"session":"verify","id":"dup-1","text":"1 と答えて"}'
sh $S/call.sh POST /api/events '{"text":""}'
```

合格:1 回目と 2 回目の返答に `hello` が出る(ファイルが残っている)。同じ `id` の 2 回目は新しく処理されない。最後は `status: 400`。

## Gotchas

- モデルは AI Gateway 経由なので、返答まで数十秒かかることがある
