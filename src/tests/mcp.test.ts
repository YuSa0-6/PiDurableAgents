import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vite-plus/test";
import worker from "../index";

const token = "s3cret";
type WorkerRequest = Parameters<typeof worker.fetch>[0];

function bound(apiToken?: string): Env {
  return {
    API_TOKEN: apiToken,
    PiAgent: env.PI_HARNESS_TEST,
  } as unknown as Env;
}

function rpc(method: string, params: unknown, id = 1): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

async function post(
  body: string,
  apiToken: string | undefined,
  headers: Record<string, string> = {},
) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request("https://mcp.d1agents.test/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body,
    }) as WorkerRequest,
    bound(apiToken),
    ctx,
  );
  const payload = await readRpc(response);
  await waitOnExecutionContext(ctx);
  return { response, payload };
}

async function readRpc(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("text/event-stream")) return JSON.parse(text) as Record<string, unknown>;
  const data = text
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line.length > 0 && line !== "[DONE]")
    .at(-1);
  if (!data) throw new Error(`empty event stream: ${text}`);
  return JSON.parse(data) as Record<string, unknown>;
}

function resultOf(payload: Record<string, unknown>): Record<string, unknown> {
  expect(payload.error, JSON.stringify(payload.error)).toBeUndefined();
  expect(payload.result).toBeTypeOf("object");
  return payload.result as Record<string, unknown>;
}

function toolText(payload: Record<string, unknown>): { text: string; isError: boolean } {
  const result = resultOf(payload);
  const content = result.content as Array<{ text: string }>;
  return { text: content[0].text, isError: result.isError === true };
}

const initialize = rpc("initialize", {
  protocolVersion: "2025-03-26",
  capabilities: {},
  clientInfo: { name: "d1agents-test", version: "0.0.0" },
});

describe("MCP", () => {
  it("initializes and lists tools", async () => {
    const opened = await post(initialize, token, { authorization: `Bearer ${token}` });
    expect(opened.response.status).toBe(200);
    const info = resultOf(opened.payload).serverInfo as { name: string };
    expect(info.name).toBe("d1agents");
    const version = resultOf(opened.payload).protocolVersion;
    expect(version).toBeTypeOf("string");

    const listed = await post(rpc("tools/list", {}), token, {
      authorization: `Bearer ${token}`,
      "mcp-protocol-version": String(version),
    });
    expect(listed.response.status).toBe(200);
    const tools = resultOf(listed.payload).tools as Array<{ name: string }>;
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "health",
      "send_event",
      "session_repos",
    ]);
  });

  it("rejects calls without the bearer token", async () => {
    const missing = await post(initialize, token);
    expect(missing.response.status).toBe(401);
    expect(missing.payload).toEqual({ error: "Unauthorized" });
    expect(missing.response.headers.get("www-authenticate")).toBe("Bearer");

    const wrong = await post(initialize, token, { authorization: "Bearer wrong" });
    expect(wrong.response.status).toBe(401);

    const ctx = createExecutionContext();
    const preflight = await worker.fetch(
      new Request("https://mcp.d1agents.test/mcp", { method: "OPTIONS" }) as WorkerRequest,
      bound(token),
      ctx,
    );
    expect(preflight.status).not.toBe(401);
    await waitOnExecutionContext(ctx);
  });

  it("answers a tool call through the agent and records an mcp source", async () => {
    const session = `mcp-${crypto.randomUUID()}`;
    const sent = await post(
      rpc("tools/call", {
        name: "send_event",
        arguments: { text: "hello from mcp", session, id: "event-1" },
      }),
      token,
      { authorization: `Bearer ${token}` },
    );
    expect(sent.response.status).toBe(200);
    const tool = toolText(sent.payload);
    expect(tool.isError).toBe(false);
    const body = JSON.parse(tool.text) as {
      event: { source: string; type: string; id: string; session: string };
      result: { status: string; text?: string; operationId: string };
    };
    expect(body.event).toMatchObject({ source: "mcp", type: "message", id: "event-1", session });
    expect(body.result.status).toBe("done");
    expect(body.result.operationId).toBe("event-1");
    expect(body.result.text).toBe("echo: hello from mcp");
    expect(await env.PI_HARNESS_TEST.getByName(session).eventSources()).toEqual(["mcp"]);
  });

  it("keeps HTTP events on the http source", async () => {
    const session = `http-${crypto.randomUUID()}`;
    const ctx = createExecutionContext();
    const response = await worker.fetch(
      new Request("http://localhost/api/events", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: "hello from http", session, id: "event-http" }),
      }) as WorkerRequest,
      bound(token),
      ctx,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      event: { source: string };
      result: { text?: string };
    };
    expect(body.event.source).toBe("http");
    expect(body.result.text).toBe("echo: hello from http");
    expect(await env.PI_HARNESS_TEST.getByName(session).eventSources()).toEqual(["http"]);
    await waitOnExecutionContext(ctx);
  });

  it("rejects empty and oversized instructions with the router rules", async () => {
    const headers = { authorization: `Bearer ${token}` };
    const empty = toolText(
      (
        await post(
          rpc("tools/call", { name: "send_event", arguments: { text: "   " } }),
          token,
          headers,
        )
      ).payload,
    );
    expect(empty.isError).toBe(true);
    expect(JSON.parse(empty.text)).toEqual({ error: "text (non-empty string) is required" });

    const oversized = toolText(
      (
        await post(
          rpc("tools/call", { name: "send_event", arguments: { text: "x".repeat(8001) } }),
          token,
          headers,
        )
      ).payload,
    );
    expect(oversized.isError).toBe(true);
    expect(JSON.parse(oversized.text)).toEqual({ error: "text must be at most 8000 characters" });
  });

  it("reports health and refuses repository tokens until API_TOKEN is set", async () => {
    const headers = { authorization: `Bearer ${token}` };
    const health = toolText(
      (await post(rpc("tools/call", { name: "health", arguments: {} }), token, headers)).payload,
    );
    expect(health.isError).toBe(false);
    expect(JSON.parse(health.text)).toMatchObject({ ok: true, auth: "bearer" });

    const open = await post(
      rpc("tools/call", { name: "session_repos", arguments: { session: "demo" } }),
      undefined,
    );
    expect(open.response.status).toBe(200);
    const refused = toolText(open.payload);
    expect(refused.isError).toBe(true);
    expect(JSON.parse(refused.text)).toEqual({
      error: "Set the API_TOKEN secret first: this route hands out read tokens.",
    });

    const repos = toolText(
      (
        await post(
          rpc("tools/call", { name: "session_repos", arguments: { session: "demo" } }),
          token,
          headers,
        )
      ).payload,
    );
    expect(repos.isError).toBe(false);
    expect(JSON.parse(repos.text)).toEqual({
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
});
