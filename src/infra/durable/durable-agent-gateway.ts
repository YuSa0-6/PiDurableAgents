import type { PiAgent } from "../../agent";
import type { AgentEvent, EventResult } from "../../domain/event";
import type { SessionId } from "../../domain/session-id";
import type { SharedRepo } from "../../domain/shared-repo";
import type { AgentGateway } from "../../usecase/ports/agent-gateway";

export class DurableAgentGateway implements AgentGateway {
  readonly #namespace: DurableObjectNamespace<PiAgent>;

  constructor(namespace: DurableObjectNamespace<PiAgent>) {
    this.#namespace = namespace;
  }

  handle(event: AgentEvent, wait: boolean): Promise<EventResult> {
    return this.#namespace.getByName(event.session).handleEvent(event, wait);
  }

  shareRepos(session: SessionId): Promise<SharedRepo[]> {
    return this.#namespace.getByName(session).shareRepos();
  }
}
