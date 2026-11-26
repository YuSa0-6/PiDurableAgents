import { InvalidInput } from "./errors";
import { modelRefOf, parseModelChoice, type ModelRef } from "./model-choice";
import { isSessionId, type SessionId } from "./session-id";

export const MAX_EVENT_TEXT = 8000;

export type EventInput = {
  readonly text?: unknown;
  readonly session?: unknown;
  readonly source?: unknown;
  readonly type?: unknown;
  readonly id?: unknown;
  readonly wait?: unknown;
  readonly model?: unknown;
};

export type AgentEvent = {
  readonly id: string;
  readonly source: string;
  readonly type: string;
  readonly text: string;
  readonly session: SessionId;
  readonly receivedAt: string;
  readonly model?: ModelRef;
};

export type EventResult = {
  readonly status: "done" | "unanswered" | "queued" | "refused";
  readonly operationId: string;
  readonly text?: string;
  readonly reason?: string;
};

export type EventDefaults = {
  readonly id: string;
  readonly source: string;
  readonly receivedAt: string;
};

export function parseEvent(input: EventInput, defaults: EventDefaults): AgentEvent {
  const session = textOr(input.session, "default");
  if (!isSessionId(session)) {
    throw new InvalidInput("session must match [A-Za-z0-9_-]{1,64}");
  }
  if (typeof input.text !== "string" || input.text.trim().length === 0) {
    throw new InvalidInput("text (non-empty string) is required");
  }
  if (input.text.length > MAX_EVENT_TEXT) {
    throw new InvalidInput(`text must be at most ${MAX_EVENT_TEXT} characters`);
  }
  const model = parseModelChoice(input.model);
  return {
    id: textOr(input.id, defaults.id),
    source: textOr(input.source, defaults.source),
    type: textOr(input.type, "message"),
    text: input.text,
    session,
    receivedAt: defaults.receivedAt,
    ...(model ? { model: modelRefOf(model) } : {}),
  };
}

export function waitsForAnswer(input: EventInput): boolean {
  return input.wait !== false;
}

function textOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}
