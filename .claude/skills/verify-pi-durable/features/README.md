# 機能の地図

| 機能                 | ファイル                                 | 入口                                               |
| -------------------- | ---------------------------------------- | -------------------------------------------------- |
| 動作確認と認証       | [health-and-auth.md](health-and-auth.md) | `GET /api/health`                                  |
| エージェントへの依頼 | [send-event.md](send-event.md)           | `POST /api/events`、MCP `send_event`               |
| 成果のリポジトリ     | [session-repos.md](session-repos.md)     | `GET /api/sessions/:id/repos`、MCP `session_repos` |
| リモート MCP         | [mcp.md](mcp.md)                         | `POST /mcp`                                        |

変えたファイルと機能の対応:

| 変えた場所                                                                  | 流す機能                                    |
| --------------------------------------------------------------------------- | ------------------------------------------- |
| `src/application/bearer.ts`、`src/infra/auth/`                              | health-and-auth                             |
| `src/application/http/`、`src/usecase/send-event.ts`、`src/domain/event.ts` | send-event                                  |
| `src/infra/pi/`、`src/infra/llm/`、`src/application/pi-agent.ts`            | send-event(ツールを使う依頼で)              |
| `src/usecase/list-session-repos.ts`、Artifacts まわり                       | session-repos                               |
| `src/application/mcp/`                                                      | mcp と、その先の send-event / session-repos |
| `cloudflare.config.ts`、依存の更新                                          | すべて                                      |
