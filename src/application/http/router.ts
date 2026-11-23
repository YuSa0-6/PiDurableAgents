import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { requireBearer } from "../bearer";
import { compose, type App } from "../compose";
import { InvalidInput } from "../../domain/errors";
import type { EventInput } from "../../domain/event";
import { health } from "../../usecase/health";
import { listSessionRepos } from "../../usecase/list-session-repos";
import { readSessionLog } from "../../usecase/read-session-log";
import { sendEvent } from "../../usecase/send-event";

export const app = new Hono<{ Bindings: Env; Variables: { app: App } }>();

app.use("/api/*", async (c, next) => {
  const deps = compose(c.env);
  const denied = await requireBearer(c.req.raw, deps.auth);
  if (denied) return denied;
  c.set("app", deps);
  return next();
});

app.get("/api/health", (c) => c.json(health(c.var.app.model)));

app.post("/api/events", async (c) => {
  const body = await readEventInput(c.req.raw);
  return c.json(await sendEvent(c.var.app, body, "http"));
});

app.get("/api/sessions/:id/repos", async (c) =>
  c.json(await listSessionRepos(c.var.app.agents, c.req.param("id") ?? "")),
);

app.get("/api/sessions/:id/log", async (c) =>
  c.json(
    await readSessionLog(c.var.app.agents, c.req.param("id") ?? "", {
      after: c.req.query("after"),
      limit: c.req.query("limit"),
    }),
  ),
);

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((error, c) => {
  if (error instanceof InvalidInput) return c.json({ error: error.message }, 400);
  if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
  console.error("Event Router request failed", error);
  return c.json({ error: error.message }, 500);
});

async function readEventInput(request: Request): Promise<EventInput> {
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null) throw new Error();
    return body as EventInput;
  } catch {
    throw new InvalidInput("body must be a JSON object");
  }
}
