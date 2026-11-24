import { env } from "cloudflare:workers";
import { waitOnExecutionContext } from "cloudflare:test";
import { agentContext } from "./agent-context";
import { describe, expect, it } from "vite-plus/test";
import worker from "../application/worker";
import { accountId, activeToken, disabledToken, stubAccountTokenVerify } from "./account-token";

type WorkerRequest = Parameters<typeof worker.fetch>[0];

const unauthorized = { error: "Send an active Account API token as Authorization: Bearer <token>" };
const auth = { authorization: `Bearer ${activeToken}` };

stubAccountTokenVerify();

function bound(): Env {
  return { ACCOUNT_ID: accountId } as unknown as Env;
}

async function call(path: string, init: RequestInit = {}) {
  const ctx = agentContext();
  const response = await worker.fetch(
    new Request(`https://agent.d1agents.test${path}`, init) as WorkerRequest,
    bound(),
    ctx,
  );
  const text = await response.text();
  await waitOnExecutionContext(ctx);
  return {
    status: response.status,
    headers: response.headers,
    body: text ? JSON.parse(text) : null,
  };
}

function postEvent(body: unknown, headers: Record<string, string> = auth) {
  return call("/api/events", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const session = () => `pin-${crypto.randomUUID()}`;

describe("HTTP contract: authentication", () => {
  it.each([
    ["no header", {}],
    ["a wrong token", { authorization: "Bearer wrong" }],
    ["a disabled token", { authorization: `Bearer ${disabledToken}` }],
    ["a non-bearer scheme", { authorization: `Basic ${activeToken}` }],
    ["a bearer with spaces", { authorization: `Bearer ${activeToken} extra` }],
  ])("answers 401 for %s", async (_, headers: Record<string, string>) => {
    const response = await call("/api/health", { headers });
    expect(response.status).toBe(401);
    expect(response.body).toEqual(unauthorized);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
  });

  it("guards every /api route, including unknown ones and health", async () => {
    expect((await call("/api/health")).status).toBe(401);
    expect((await call("/api/nope")).status).toBe(401);
    expect((await postEvent({ text: "hi" }, {})).status).toBe(401);
    expect((await call("/api/sessions/demo/repos")).status).toBe(401);
    expect((await call("/api/sessions/demo/log")).status).toBe(401);
  });

  it("adds CORS headers to a rejected MCP request and lets the preflight through", async () => {
    const rejected = await call("/mcp", { method: "POST", body: "{}" });
    expect(rejected.status).toBe(401);
    expect(rejected.body).toEqual(unauthorized);
    expect(rejected.headers.get("access-control-allow-origin")).toBe("*");
    expect(rejected.headers.get("access-control-allow-methods")).toBe("GET, POST, DELETE, OPTIONS");

    const preflight = await call("/mcp", { method: "OPTIONS" });
    expect(preflight.status).not.toBe(401);
  });
});

describe("HTTP contract: routes", () => {
  it("reports health with the fixed model", async () => {
    const response = await call("/api/health", { headers: auth });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, model: "z-ai/glm-5.3" });
  });

  it("answers 404 as JSON outside the known routes", async () => {
    for (const path of ["/", "/nope"]) {
      const response = await call(path);
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "Not found" });
    }
    const unknownApi = await call("/api/nope", { headers: auth });
    expect(unknownApi.status).toBe(404);
    expect(unknownApi.body).toEqual({ error: "Not found" });
  });

  it("lists a session's repositories", async () => {
    const response = await call("/api/sessions/demo/repos", { headers: auth });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      repos: [
        {
          name: "demo",
          remote: "https://example.test/demo.git",
          defaultBranch: "main",
          lastPushAt: null,
          readToken: "read-token",
          expiresAt: "2026-11-07T01:00:00Z",
        },
      ],
    });
  });

  it("rejects a repository listing for an invalid session name", async () => {
    const response = await call("/api/sessions/bad.name/repos", { headers: auth });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "invalid session id" });
  });
});

describe("HTTP contract: POST /api/events validation", () => {
  it.each([
    ["invalid JSON", "{", "body must be a JSON object"],
    ["JSON null", "null", "body must be a JSON object"],
    ["a JSON string", '"hi"', "body must be a JSON object"],
    ["a missing text", {}, "text (non-empty string) is required"],
    ["a non-string text", { text: 1 }, "text (non-empty string) is required"],
    ["a blank text", { text: " \n\t" }, "text (non-empty string) is required"],
    [
      "text over 8000 characters",
      { text: "x".repeat(8001) },
      "text must be at most 8000 characters",
    ],
    [
      "an invalid session",
      { text: "hi", session: "a/b" },
      "session must match [A-Za-z0-9_-]{1,64}",
    ],
    [
      "a session over 64 characters",
      { text: "hi", session: "s".repeat(65) },
      "session must match [A-Za-z0-9_-]{1,64}",
    ],
  ])("answers 400 for %s", async (_, body, error) => {
    const response = await postEvent(body);
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error });
  });

  it("checks the session before the text", async () => {
    const response = await postEvent({ session: "a/b" });
    expect(response.body).toEqual({ error: "session must match [A-Za-z0-9_-]{1,64}" });
  });
});

describe("HTTP contract: POST /api/events dispatch", () => {
  it("fills defaults for an event with only text", async () => {
    const before = Date.now();
    const response = await postEvent({ text: "hello defaults" });
    expect(response.status).toBe(200);
    const { event, result } = response.body;
    expect(event).toMatchObject({
      source: "http",
      type: "message",
      text: "hello defaults",
      session: "default",
    });
    expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(event.receivedAt)).toBeGreaterThanOrEqual(before - 1000);
    expect(result).toEqual({
      status: "done",
      operationId: event.id,
      text: "echo: hello defaults",
    });
  });

  it("keeps the caller's id, source, type and session", async () => {
    const name = session();
    const response = await postEvent({
      text: "hello fields",
      session: name,
      id: "event-pin",
      source: "webhook",
      type: "push",
    });
    expect(response.status).toBe(200);
    expect(response.body.event).toMatchObject({
      id: "event-pin",
      source: "webhook",
      type: "push",
      session: name,
    });
    expect(response.body.result.operationId).toBe("event-pin");
    expect(await env.PI_HARNESS_TEST.getByName(name).eventSources()).toEqual(["webhook"]);
  });

  it("treats empty optional strings as missing", async () => {
    const response = await postEvent({ text: "hi", session: "", id: "", source: "", type: "" });
    expect(response.status).toBe(200);
    expect(response.body.event).toMatchObject({
      session: "default",
      source: "http",
      type: "message",
    });
    expect(response.body.event.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("accepts text of exactly 8000 characters", async () => {
    const response = await postEvent({ text: "y".repeat(8000), session: session() });
    expect(response.status).toBe(200);
    expect(response.body.result.status).toBe("done");
  });

  it("queues without waiting when wait is false", async () => {
    const response = await postEvent({
      text: "later",
      session: session(),
      id: "event-queued",
      wait: false,
    });
    expect(response.status).toBe(200);
    expect(response.body.result).toEqual({ status: "queued", operationId: "event-queued" });
  });

  it("waits for any wait value other than false", async () => {
    const response = await postEvent({ text: "now", session: session(), wait: "false" });
    expect(response.body.result.status).toBe("done");
  });
});

describe("HTTP contract: GET /api/sessions/:id/log", () => {
  const log = (name: string, query = "") =>
    call(`/api/sessions/${name}/log${query}`, { headers: auth });

  it("returns an empty log for a new session", async () => {
    const response = await log(session());
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ busy: false, pending: [], entries: [], lastSeq: 0 });
  });

  it("shows the event, the question and the answer in order, and reads on after lastSeq", async () => {
    const name = session();
    await postEvent({ text: "hello", session: name, source: "webhook" });
    const first = await log(name);
    expect(first.status).toBe(200);
    expect(first.body.busy).toBe(false);
    const seqs = first.body.entries.map((entry: { seq: number }) => entry.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(first.body.lastSeq).toBe(seqs.at(-1));
    expect(first.body.entries).toContainEqual(
      expect.objectContaining({ kind: "app.event", data: { source: "webhook", type: "message" } }),
    );
    const messages = first.body.entries.flatMap(
      (entry: { messages?: unknown[] }) => entry.messages ?? [],
    );
    expect(messages).toContainEqual({ role: "user", text: "hello" });
    expect(messages).toContainEqual(
      expect.objectContaining({ role: "assistant", text: "echo: hello" }),
    );
    expect(
      first.body.entries.find((entry: { messages?: unknown[] }) => entry.messages)?.time,
    ).toBeTypeOf("number");

    const rest = await log(name, `?after=${first.body.lastSeq}`);
    expect(rest.body).toEqual({
      busy: false,
      pending: [],
      entries: [],
      lastSeq: first.body.lastSeq,
    });

    const paged = await log(name, "?limit=1");
    expect(paged.body.entries).toHaveLength(1);
    expect(paged.body.lastSeq).toBe(seqs[0]);
  });

  it("names the tool and its result, and cuts long text", async () => {
    const name = session();
    const long = "z".repeat(5000);
    await env.PI_HARNESS_TEST.getByName(name).writeWorkspaceFile("/workspace/long.txt", long);
    await postEvent({ text: "read /workspace/long.txt", session: name });
    const messages = (await log(name)).body.entries.flatMap(
      (entry: { messages?: unknown[] }) => entry.messages ?? [],
    );
    expect(messages).toContainEqual(
      expect.objectContaining({ role: "assistant", toolCalls: ["read"] }),
    );
    const result = messages.find((message: { role: string }) => message.role === "toolResult");
    expect(result).toMatchObject({ toolName: "read", isError: false, truncated: true });
    expect(result.text).toHaveLength(4000);
  });

  it.each([
    ["/api/sessions/bad.name/log", "invalid session id"],
    ["/api/sessions/demo/log?after=-1", "after must be a whole number of 0 or more"],
    ["/api/sessions/demo/log?after=x", "after must be a whole number of 0 or more"],
    ["/api/sessions/demo/log?limit=1.5", "limit must be a whole number of 0 or more"],
  ])("answers 400 for %s", async (path, error) => {
    const response = await call(path, { headers: auth });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error });
  });
});
