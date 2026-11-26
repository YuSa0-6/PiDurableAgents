import { describe, expect, it } from "vite-plus/test";
import type { AgentEvent } from "../../domain/event";
import type { ModelRef } from "../../domain/model-choice";
import { runEvent, storedModelMemory } from "./run-event";

const GLM = { provider: "openrouter", id: "z-ai/glm-5.3" };
const SONNET = { provider: "anthropic", id: "claude-sonnet-5-5" };

function fakeSession(busy: boolean) {
  const calls: string[] = [];
  return {
    calls,
    session: {
      prompt: async () => {
        calls.push("prompt");
        return { status: "done" as const, operationId: "e1", text: "ok" };
      },
      submit: async () => {
        calls.push("submit");
        return { operationId: "e1" };
      },
      setModel: async (model: ModelRef) => {
        calls.push(`setModel ${model.provider}/${model.id}`);
      },
      busy: async () => busy,
    },
  };
}

function memoryMap() {
  const map = new Map<string, unknown>();
  return {
    map,
    memory: storedModelMemory(
      { get: (key) => map.get(key), put: (key, value) => map.set(key, value) },
      GLM,
    ),
  };
}

function event(model?: ModelRef): AgentEvent {
  return {
    id: "e1",
    source: "mcp",
    type: "message",
    text: "hi",
    session: "s" as AgentEvent["session"],
    receivedAt: "2026-11-26T00:00:00.000Z",
    ...(model ? { model } : {}),
  };
}

describe("runEvent model choice", () => {
  it("keeps the session's model when the event names none", async () => {
    const { session, calls } = fakeSession(false);
    const { memory } = memoryMap();
    await runEvent(session, event(), true, memory);
    expect(calls).toEqual(["prompt"]);
  });

  it("skips the switch when the event names the current model", async () => {
    const { session, calls } = fakeSession(true);
    const { memory } = memoryMap();
    await runEvent(session, event(GLM), false, memory);
    expect(calls).toEqual(["submit"]);
  });

  it("switches an idle session and remembers the choice", async () => {
    const { session, calls } = fakeSession(false);
    const { memory } = memoryMap();
    await runEvent(session, event(SONNET), true, memory);
    expect(calls).toEqual(["setModel anthropic/claude-sonnet-5-5", "prompt"]);
    expect(memory.current()).toEqual(SONNET);
    const again = fakeSession(true);
    await runEvent(again.session, event(SONNET), false, memory);
    expect(again.calls).toEqual(["submit"]);
  });

  it("refuses a switch while the session is busy and submits nothing", async () => {
    const { session, calls } = fakeSession(true);
    const { memory } = memoryMap();
    const result = await runEvent(session, event(SONNET), false, memory);
    expect(result).toEqual({
      status: "refused",
      operationId: "e1",
      reason:
        "The session is busy with z-ai/glm-5.3. Send model claude-sonnet-5-5 again when it is idle.",
    });
    expect(calls).toEqual([]);
    expect(memory.current()).toEqual(GLM);
  });

  it("falls back to the default when the stored value is not a model", () => {
    const { map, memory } = memoryMap();
    map.set("app.model", "broken");
    expect(memory.current()).toEqual(GLM);
  });
});
