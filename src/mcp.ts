import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { AgentApi, HttpError } from "./agent-api";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "Content-Type, Accept, Authorization, mcp-session-id, MCP-Protocol-Version, Mcp-Method, Mcp-Name",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
};

const sendInput = z.object({
  text: z
    .string()
    .describe(
      "Instruction for the agent. Empty text, and text longer than 8,000 characters, is rejected.",
    ),
  session: z
    .string()
    .optional()
    .describe(
      "Durable Object name. The same name continues the conversation and workspace. Defaults to default. Must match [A-Za-z0-9_-]{1,64}.",
    ),
  id: z.string().optional().describe("Idempotency key. The same id is processed once."),
  wait: z
    .boolean()
    .optional()
    .describe(
      "Wait for the answer. Defaults to true. False accepts the instruction and answers in the background.",
    ),
});

const reposInput = z.object({
  session: z.string().describe("Session name, the Durable Object name used with send_event."),
});

type SendInput = z.infer<typeof sendInput>;
type ReposInput = z.infer<typeof reposInput>;

export class AgentMcp {
  static readonly path = "/mcp";

  static async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== "OPTIONS") {
      const denied = await AgentApi.authorize(request, env.API_TOKEN);
      if (denied) return AgentMcp.#cors(denied);
    }
    const handler = createMcpHandler(() => AgentMcp.#server(env), {
      route: AgentMcp.path,
      onerror: (error) => console.error("MCP request failed", error),
    });
    return handler(request, env, ctx);
  }

  static #server(env: Env): McpServer {
    const server = new McpServer({ name: "d1agents", version: "0.0.0" });
    server.registerTool(
      "send_event",
      {
        title: "Send event",
        description:
          "Send an instruction to the Pi agent. Same validation and dispatch as POST /api/events. The conversation log records source mcp.",
        inputSchema: sendInput,
      },
      (input) => AgentMcp.#sendEvent(env, input),
    );
    server.registerTool(
      "session_repos",
      {
        title: "Session repositories",
        description:
          "List one session's Artifacts repositories and a one-hour read-only git token for each. Same payload as GET /api/sessions/:id/repos. Refuses when API_TOKEN is unset, because the response contains read tokens.",
        inputSchema: reposInput,
      },
      (input) => AgentMcp.#sessionRepos(env, input),
    );
    server.registerTool(
      "health",
      {
        title: "Health",
        description:
          "Report whether the worker is up, whether bearer auth is required, and which model it uses. Same payload as GET /api/health.",
        annotations: { readOnlyHint: true },
      },
      () => AgentMcp.#health(env),
    );
    return server;
  }

  static async #sendEvent(env: Env, input: SendInput) {
    try {
      return AgentMcp.#ok(
        await AgentApi.send(env, {
          text: input.text,
          session: input.session,
          id: input.id,
          wait: input.wait,
          source: "mcp",
          type: "message",
        }),
      );
    } catch (error) {
      return AgentMcp.#fail(error);
    }
  }

  static async #sessionRepos(env: Env, input: ReposInput) {
    try {
      return AgentMcp.#ok(await AgentApi.repos(env, input.session));
    } catch (error) {
      return AgentMcp.#fail(error);
    }
  }

  static #health(env: Env) {
    try {
      return AgentMcp.#ok(AgentApi.health(env));
    } catch (error) {
      return AgentMcp.#fail(error);
    }
  }

  static #ok(value: unknown) {
    return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
  }

  static #fail(error: unknown) {
    const message =
      error instanceof HttpError || error instanceof Error ? error.message : "Request failed";
    return {
      isError: true as const,
      content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
    };
  }

  static #cors(response: Response): Response {
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(corsHeaders)) headers.set(name, value);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}
