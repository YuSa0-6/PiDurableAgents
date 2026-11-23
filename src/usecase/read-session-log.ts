import { InvalidInput } from "../domain/errors";
import { isSessionId } from "../domain/session-id";
import { parseLogQuery, type LogQueryInput, type SessionLog } from "../domain/session-log";
import type { AgentGateway } from "./ports/agent-gateway";

export async function readSessionLog(
  agents: AgentGateway,
  session: string,
  input: LogQueryInput,
): Promise<SessionLog> {
  if (!isSessionId(session)) throw new InvalidInput("invalid session id");
  return agents.readLog(session, parseLogQuery(input));
}
