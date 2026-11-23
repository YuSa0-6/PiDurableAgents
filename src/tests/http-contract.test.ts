import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vite-plus/test";
import worker from "../application/worker";
import { accountId, activeToken, disabledToken, stubAccountTokenVerify } from "./account-token";

type WorkerRequest = Parameters<typeof worker.fetch>[0];

const unauthorized = { error: "Send an active Account API token as Authorization: Bearer <token>" };
const auth = { authorization: `Bearer ${activeToken}` };

stubAccountTokenVerify();

function bound(extra: Record<string, string> = {}): Env {
  return { ACCOUNT_ID: accountId, PiAgent: env.PI_HARNESS_TEST, ...extra } as unknown as Env;
}

async function call(
  path: string,
  init: RequestInit = {},
  origin = "https://agent.d1agents.test",
  extra: Record<string, string> = {},
) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`${origin}${path}`, init) as WorkerRequest,
    bound(extra),
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

describe("HTTP contract: local dev without a token", () => {
  const skip = { SKIP_AUTH_ON_LOCALHOST: "1" };

  it.each(["http://localhost:5173", "http://127.0.0.1:5173", "http://[::1]:5173"])(
    "lets %s through when SKIP_AUTH_ON_LOCALHOST is 1",
    async (origin) => {
      expect((await call("/api/health", {}, origin, skip)).status).toBe(200);
      expect((await call("/mcp", { method: "POST", body: "{}" }, origin, skip)).status).not.toBe(
        401,
      );
    },
  );

  it("keeps a public host behind the token even when SKIP_AUTH_ON_LOCALHOST is 1", async () => {
    expect((await call("/api/health", {}, undefined, skip)).status).toBe(401);
    expect((await call("/mcp", { method: "POST", body: "{}" }, undefined, skip)).status).toBe(401);
    for (const origin of [
      "https://localhost.d1agents.test",
      "http://localhost.:5173",
      "http://127.0.0.2:5173",
      "http://0.0.0.0:5173",
    ]) {
      expect((await call("/api/health", {}, origin, skip)).status).toBe(401);
    }
  });

  it.each<Record<string, string>>([
    {},
    { SKIP_AUTH_ON_LOCALHOST: "true" },
    { SKIP_AUTH_ON_LOCALHOST: "0" },
  ])("keeps localhost behind the token unless the flag is exactly 1 (%o)", async (extra) => {
    expect((await call("/api/health", {}, "http://localhost:5173", extra)).status).toBe(401);
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
