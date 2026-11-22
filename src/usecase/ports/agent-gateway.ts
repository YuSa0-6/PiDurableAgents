import type { AgentEvent, EventResult } from "../../domain/event";
import type { SessionId } from "../../domain/session-id";
import type { SharedRepo } from "../../domain/shared-repo";

export interface AgentGateway {
  handle(event: AgentEvent, wait: boolean): Promise<EventResult>;
  shareRepos(session: SessionId): Promise<SharedRepo[]>;
}
