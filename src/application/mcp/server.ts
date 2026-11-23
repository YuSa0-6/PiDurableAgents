import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { requireBearer } from "../bearer";
import { compose, type App } from "../compose";
import { health } from "../../usecase/health";
import { listSessionRepos } from "../../usecase/list-session-repos";
import { sendEvent } from "../../usecase/send-event";

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

export class AgentMcp {
  static readonly path = "/mcp";

  static async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const app = compose(env);
    if (request.method !== "OPTIONS") {
      const denied = await requireBearer(request, app);
      if (denied) return AgentMcp.#cors(denied);
    }
    const handler = createMcpHandler(() => AgentMcp.#server(app), {
      route: AgentMcp.path,
      onerror: (error) => console.error("MCP request failed", error),
    });
    return handler(request, env, ctx);
  }

  static #server(app: App): McpServer {
    const server = new McpServer({ name: "d1agents", version: "0.0.0" });
    server.registerTool(
      "send_event",
      {
        title: "Send event",
        description:
          "Send an instruction to the Pi agent. Same validation and dispatch as POST /api/events. The conversation log records source mcp.",
        inputSchema: sendInput,
      },
      (input) =>
        AgentMcp.#reply(() =>
          sendEvent(
            app,
            { text: input.text, session: input.session, id: input.id, wait: input.wait },
            "mcp",
          ),
        ),
    );
    server.registerTool(
      "session_repos",
      {
        title: "Session repositories",
        description:
          "List one session's Artifacts repositories and a one-hour read-only git token for each. Same payload as GET /api/sessions/:id/repos.",
        inputSchema: reposInput,
      },
      (input) => AgentMcp.#reply(() => listSessionRepos(app.agents, input.session)),
    );
    server.registerTool(
      "health",
      {
        title: "Health",
        description:
          "Report whether the worker is up and which model it uses. Same payload as GET /api/health.",
        annotations: { readOnlyHint: true },
      },
      () => AgentMcp.#reply(() => health(app.model)),
    );
    return server;
  }

  static async #reply(run: () => unknown) {
    try {
      return AgentMcp.#text(await run());
    } catch (error) {
      return {
        isError: true as const,
        ...AgentMcp.#text({ error: error instanceof Error ? error.message : "Request failed" }),
      };
    }
  }

  static #text(value: unknown) {
    return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
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
