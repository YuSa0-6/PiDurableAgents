import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { AgentApi, HttpError } from "./agent-api";

export const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/health") return next();
  const denied = await AgentApi.authorize(c.req.raw, c.env.API_TOKEN);
  if (denied) return denied;
  return next();
});

app.get("/api/health", (c) => c.json(AgentApi.health(c.env)));

app.post("/api/events", async (c) => {
  const body = await AgentApi.readJson(c.req.raw);
  return c.json(await AgentApi.send(c.env, body));
});

app.get("/api/sessions/:id/repos", async (c) =>
  c.json(await AgentApi.repos(c.env, c.req.param("id") ?? "")),
);

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((error, c) => {
  if (error instanceof HttpError || error instanceof HTTPException) {
    return c.json({ error: error.message }, error.status);
  }
  console.error("Event Router request failed", error);
  return c.json({ error: error.message }, 500);
});
