import type { AgentEvent, EventResult } from "../../domain/event";
import type { SessionId } from "../../domain/session-id";
import type { SharedRepo } from "../../domain/shared-repo";
import type { AgentGateway } from "../../usecase/ports/agent-gateway";

export type AgentObjects = {
  getByName(name: string): {
    handleEvent(event: AgentEvent, wait: boolean): Promise<EventResult>;
    shareRepos(): Promise<SharedRepo[]>;
  };
};

export class DurableAgentGateway implements AgentGateway {
  readonly #objects: AgentObjects;

  constructor(objects: AgentObjects) {
    this.#objects = objects;
  }

  handle(event: AgentEvent, wait: boolean): Promise<EventResult> {
    return this.#objects.getByName(event.session).handleEvent(event, wait);
  }

  shareRepos(session: SessionId): Promise<SharedRepo[]> {
    return this.#objects.getByName(session).shareRepos();
  }
}
