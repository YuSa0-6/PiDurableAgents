import type { PiSubmitOptions } from "agents/harness/pi";
import type { AgentEvent, EventResult } from "../../domain/event";
import { sameModel, type ModelRef } from "../../domain/model-choice";

type SessionRunner = {
  prompt(input: string, options?: PiSubmitOptions): Promise<EventResult>;
  submit(input: string, options?: PiSubmitOptions): Promise<{ readonly operationId: string }>;
  setModel(model: ModelRef): Promise<void>;
  busy(): Promise<boolean>;
};

export type ModelMemory = {
  current(): ModelRef;
  remember(model: ModelRef): void;
};

export async function runEvent(
  session: SessionRunner,
  event: AgentEvent,
  wait: boolean,
  memory: ModelMemory,
): Promise<EventResult> {
  if (event.model && !sameModel(memory.current(), event.model)) {
    if (await session.busy()) {
      return {
        status: "refused",
        operationId: event.id,
        reason: `The session is busy with ${memory.current().id}. Send model ${event.model.id} again when it is idle.`,
      };
    }
    await session.setModel(event.model);
    memory.remember(event.model);
  }
  const options: PiSubmitOptions = {
    operationId: event.id,
    entry: { kind: "app.event", data: { source: event.source, type: event.type } },
  };
  if (!wait) {
    const receipt = await session.submit(event.text, options);
    return { status: "queued", operationId: receipt.operationId };
  }
  const { status, text, reason, operationId } = await session.prompt(event.text, options);
  return { status, operationId, text, reason };
}

export function storedModelMemory(
  storage: { get(key: string): unknown; put(key: string, value: unknown): void },
  fallback: ModelRef,
): ModelMemory {
  return {
    current: () => {
      const stored = storage.get(MODEL_KEY);
      return isModelRef(stored) ? stored : fallback;
    },
    remember: (model) => storage.put(MODEL_KEY, { provider: model.provider, id: model.id }),
  };
}

const MODEL_KEY = "app.model";

function isModelRef(value: unknown): value is ModelRef {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ModelRef).provider === "string" &&
    typeof (value as ModelRef).id === "string"
  );
}
