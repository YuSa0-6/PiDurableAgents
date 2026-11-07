/** The Worker: the Event Router for every request, and the PiAgent Durable Object. */
import { app } from "./router";

export { PiAgent } from "./agent";

export default {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx)
} satisfies ExportedHandler<Env>;
