import { app } from "./router";

export { PiAgent } from "./agent";

export default {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx)
} satisfies ExportedHandler<Env>;
