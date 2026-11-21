import { AgentMcp } from "./mcp";
import { app } from "./router";

export { PiAgent } from "./agent";

export default {
  fetch: (request, env, ctx) =>
    new URL(request.url).pathname === AgentMcp.path
      ? AgentMcp.fetch(request, env, ctx)
      : app.fetch(request, env, ctx),
} satisfies ExportedHandler<Env>;
