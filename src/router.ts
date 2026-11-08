import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { PiAgent } from "./agent";
import type { RouterEvent } from "./event";
import { MODEL_ID } from "./model";

type EventBody = {
  readonly text?: unknown;
  readonly session?: unknown;
  readonly source?: unknown;
  readonly type?: unknown;
  readonly id?: unknown;
  readonly wait?: unknown;
};

const SESSION_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_TEXT = 8000;

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function badRequest(message: string): HTTPException {
  return new HTTPException(400, { message });
}

function normalise(body: EventBody): RouterEvent {
  const session = str(body.session, "default");
  if (!SESSION_PATTERN.test(session)) {
    throw badRequest("session must match [A-Za-z0-9_-]{1,64}");
  }
  if (typeof body.text !== "string" || body.text.trim().length === 0) {
    throw badRequest("text (non-empty string) is required");
  }
  if (body.text.length > MAX_TEXT) {
    throw badRequest(`text must be at most ${MAX_TEXT} characters`);
  }
  return {
    id: str(body.id, crypto.randomUUID()),
    source: str(body.source, "http"),
    type: str(body.type, "message"),
    text: body.text,
    session,
    receivedAt: new Date().toISOString()
  };
}

async function readJson(request: Request): Promise<EventBody> {
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null) throw new Error();
    return body as EventBody;
  } catch {
    throw badRequest("body must be a JSON object");
  }
}

function agentOf(env: Env, session: string): DurableObjectStub<PiAgent> {
  return (env.PiAgent as unknown as DurableObjectNamespace<PiAgent>).getByName(session);
}

function sessionAgent(c: Context<{ Bindings: Env }>): DurableObjectStub<PiAgent> {
  const id = c.req.param("id") ?? "";
  if (!SESSION_PATTERN.test(id)) throw badRequest("invalid session id");
  return agentOf(c.env, id);
}

export const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", async (c, next) => {
  if (!accessOf(c)) return c.json({ error: "Sign in with Cloudflare Access" }, 403);
  return next();
});

function accessOf(c: Context<{ Bindings: Env }>): CloudflareAccessContext | undefined {
  try {
    return (c.executionCtx as ExecutionContext).access;
  } catch {
    return undefined;
  }
}

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    model: MODEL_ID
  })
);

app.post("/api/events", async (c) => {
  const body = await readJson(c.req.raw);
  const event = normalise(body);
  const result = await agentOf(c.env, event.session).handleEvent(event, body.wait !== false);
  return c.json({ event, result });
});

app.get("/api/sessions/:id/repos", async (c) =>
  c.json({ repos: await sessionAgent(c).shareRepos() })
);

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ error: error.message }, error.status);
  }
  console.error("Event Router request failed", error);
  return c.json({ error: error.message }, 500);
});
