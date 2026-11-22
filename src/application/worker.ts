import { AgentMcp } from "./mcp/server";
import { app } from "./http/router";

export { PiAgent } from "./pi-agent";
export { Sandbox } from "./sandbox";

export default {
  fetch: (request, env, ctx) =>
    new URL(request.url).pathname === AgentMcp.path
      ? AgentMcp.fetch(request, env, ctx)
      : app.fetch(request, env, ctx),
} satisfies ExportedHandler<Env>;
