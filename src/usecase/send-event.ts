import {
  parseEvent,
  waitsForAnswer,
  type AgentEvent,
  type EventInput,
  type EventResult,
} from "../domain/event";
import type { AgentGateway } from "./ports/agent-gateway";
import type { Clock } from "./ports/clock";
import type { Ids } from "./ports/ids";

export type SendEventDeps = {
  readonly agents: AgentGateway;
  readonly clock: Clock;
  readonly ids: Ids;
};

export async function sendEvent(
  deps: SendEventDeps,
  input: EventInput,
  source: string,
): Promise<{ event: AgentEvent; result: EventResult }> {
  const event = parseEvent(input, { id: deps.ids.next(), source, receivedAt: deps.clock.now() });
  const result = await deps.agents.handle(event, waitsForAnswer(input));
  return { event, result };
}
