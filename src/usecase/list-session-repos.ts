import { InvalidInput } from "../domain/errors";
import { isSessionId } from "../domain/session-id";
import type { SharedRepo } from "../domain/shared-repo";
import type { AgentGateway } from "./ports/agent-gateway";

export async function listSessionRepos(
  agents: AgentGateway,
  session: string,
): Promise<{ repos: SharedRepo[] }> {
  if (!isSessionId(session)) throw new InvalidInput("invalid session id");
  return { repos: await agents.shareRepos(session) };
}
