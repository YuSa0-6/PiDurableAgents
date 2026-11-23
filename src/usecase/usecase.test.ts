import { describe, expect, it } from "vite-plus/test";
import type { AgentEvent } from "../domain/event";
import { InvalidInput } from "../domain/errors";
import { health } from "./health";
import { listSessionRepos } from "./list-session-repos";
import { readSessionLog } from "./read-session-log";
import type { AgentGateway } from "./ports/agent-gateway";
import { sendEvent } from "./send-event";

function fakeAgents() {
  const handled: Array<{ event: AgentEvent; wait: boolean }> = [];
  const agents: AgentGateway = {
    handle: async (event, wait) => {
      handled.push({ event, wait });
      return wait
        ? { status: "done", operationId: event.id, text: `echo: ${event.text}` }
        : { status: "queued", operationId: event.id };
    },
    shareRepos: async (session) => [
      {
        name: session,
        remote: `https://example.test/${session}.git`,
        defaultBranch: "main",
        lastPushAt: null,
        readToken: "t",
        expiresAt: "2026-11-22T01:00:00Z",
      },
    ],
    readLog: async (_session, query) => ({
      busy: false,
      pending: [],
      entries: [],
      lastSeq: query.after,
    }),
  };
  return { agents, handled };
}

const clock = { now: () => "2026-11-22T00:00:00.000Z" };
const ids = { next: () => "id-1" };

describe("sendEvent", () => {
  it("builds the event from the ports and hands it to the agent", async () => {
    const { agents, handled } = fakeAgents();
    const sent = await sendEvent({ agents, clock, ids }, { text: "hi" }, "mcp");
    expect(sent.event).toEqual({
      id: "id-1",
      source: "mcp",
      type: "message",
      text: "hi",
      session: "default",
      receivedAt: "2026-11-22T00:00:00.000Z",
    });
    expect(sent.result).toEqual({ status: "done", operationId: "id-1", text: "echo: hi" });
    expect(handled).toEqual([{ event: sent.event, wait: true }]);
  });

  it("passes wait false through and never calls the agent on invalid input", async () => {
    const { agents, handled } = fakeAgents();
    const queued = await sendEvent({ agents, clock, ids }, { text: "hi", wait: false }, "http");
    expect(queued.result.status).toBe("queued");
    await expect(sendEvent({ agents, clock, ids }, { text: "" }, "http")).rejects.toThrow(
      InvalidInput,
    );
    expect(handled).toHaveLength(1);
  });
});

describe("listSessionRepos", () => {
  it("lists repos for a valid session and refuses an invalid one", async () => {
    const { agents } = fakeAgents();
    expect((await listSessionRepos(agents, "demo")).repos.map((r) => r.name)).toEqual(["demo"]);
    await expect(listSessionRepos(agents, "bad.name")).rejects.toThrow(
      new InvalidInput("invalid session id"),
    );
  });
});

describe("health", () => {
  it("reports the model", () => {
    expect(health("m")).toEqual({ ok: true, model: "m" });
  });
});

describe("readSessionLog", () => {
  it("parses the query and asks the session", async () => {
    const { agents } = fakeAgents();
    expect(await readSessionLog(agents, "demo", { after: "5" })).toEqual({
      busy: false,
      pending: [],
      entries: [],
      lastSeq: 5,
    });
  });

  it("rejects an invalid session before asking", async () => {
    const { agents } = fakeAgents();
    await expect(readSessionLog(agents, "bad.name", {})).rejects.toThrow(InvalidInput);
  });
});
