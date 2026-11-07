import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { PiAgent } from "./agent";
import { DECISION_MODEL, decide, MIN_CONFIDENCE } from "./decision-model";
import type { RouterEvent } from "./event";
import {
  DEFAULT_MODEL,
  EXECUTION_MODELS,
  isExecutionModel,
  type ExecutionModelId
} from "./execution-models";

/**
 * Event Router (Hono): the entry point for every event.
 *
 *   HTTP / webhook ──▶ Event Router ──▶ DecisionModel (d1.1) ──▶ PiAgent (Pi Durable) ──▶ OpenRouter LLM
 *
 * | Method | Path                          | What it does                                  |
 * | ------ | ----------------------------- | --------------------------------------------- |
 * | GET    | /api/health                   | Liveness and the routing policy               |
 * | POST   | /api/decide                   | DecisionModel only (dry run, no answer)       |
 * | POST   | /api/events                   | Router → DecisionModel → Pi agent → LLM       |
 * | GET    | /api/sessions/:id/decisions   | The decisions a session's object has logged   |
 * | GET    | /api/sessions/:id/repos       | The session's Artifacts repos, with read tokens |
 *
 * When the API_TOKEN secret is set, every route but /api/health needs
 * `Authorization: Bearer <API_TOKEN>`.
 */

/** The JSON body `/api/events` and `/api/decide` accept. */
type EventBody = {
  readonly text?: unknown;
  readonly session?: unknown;
  readonly source?: unknown;
  readonly type?: unknown;
  readonly id?: unknown;
  /** Default true: wait for the answer. False: return once Pi has the event. */
  readonly wait?: unknown;
  /** An execution model id to use instead of asking the DecisionModel. */
  readonly model?: unknown;
};

const SESSION_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function badRequest(message: string): HTTPException {
  return new HTTPException(400, { message });
}

/** Normalise any accepted body into a RouterEvent. */
function normalise(body: EventBody): RouterEvent {
  const session = str(body.session, "default");
  if (!SESSION_PATTERN.test(session)) {
    throw badRequest("session must match [A-Za-z0-9_-]{1,64}");
  }
  if (typeof body.text !== "string") {
    throw badRequest("text (string) is required");
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

function override(body: EventBody): ExecutionModelId | undefined {
  if (body.model === undefined) return undefined;
  if (typeof body.model !== "string" || !isExecutionModel(body.model)) {
    throw badRequest(
      `model must be one of: ${EXECUTION_MODELS.map((model) => model.id).join(", ")}`
    );
  }
  return body.model;
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

/**
 * The PiAgent object of a session. cf types a Durable Object binding whose
 * Worker is named by string without the class, so add the class here.
 */
function agentOf(env: Env, session: string): DurableObjectStub<PiAgent> {
  return (env.PiAgent as unknown as DurableObjectNamespace<PiAgent>).getByName(session);
}

/** The PiAgent object of the session named in the path. */
function sessionAgent(c: Context<{ Bindings: Env }>): DurableObjectStub<PiAgent> {
  const id = c.req.param("id") ?? "";
  if (!SESSION_PATTERN.test(id)) throw badRequest("invalid session id");
  return agentOf(c.env, id);
}

export const app = new Hono<{ Bindings: Env }>();

// Bearer auth for everything but the health check, once API_TOKEN is set.
app.use("/api/*", async (c, next) => {
  const expected = c.env.API_TOKEN;
  if (!expected || c.req.path === "/api/health") return next();
  const given = c.req.header("authorization")?.match(/^Bearer (.+)$/)?.[1] ?? "";
  if (!(await sameSecret(given, expected))) {
    return c.json({ error: "Unauthorized" }, 401, { "www-authenticate": "Bearer" });
  }
  return next();
});

/**
 * Compare two secrets without leaking where they differ: compare their
 * SHA-256 digests (same length whatever the input) byte by byte, without
 * stopping early.
 */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [x, y] = await Promise.all(
    [a, b].map(async (value) => new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))))
  );
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    auth: c.env.API_TOKEN ? "bearer" : "none",
    flow: "Event Router (Hono) → DecisionModel (Liquid d1.1) → PiAgent (Pi Durable) → OpenRouter LLM",
    decisionModel: DECISION_MODEL,
    minConfidence: MIN_CONFIDENCE,
    defaultModel: DEFAULT_MODEL,
    executionModels: EXECUTION_MODELS
  })
);

app.post("/api/decide", async (c) => {
  const body = await readJson(c.req.raw);
  const event = normalise(body);
  return c.json({ event, decision: await decide(c.env, event, override(body)) });
});

app.post("/api/events", async (c) => {
  const body = await readJson(c.req.raw);
  const event = normalise(body);
  const decision = await decide(c.env, event, override(body));
  if (decision.action === "reject") {
    return c.json({ event, decision }, 422);
  }
  const agent = agentOf(c.env, event.session);
  const result = await agent.handleEvent(event, decision, body.wait !== false);
  return c.json({ event, decision, result });
});

app.get("/api/sessions/:id/decisions", async (c) =>
  c.json({ decisions: await sessionAgent(c).decisions(50) })
);

// Read access to the session's Artifacts repositories, so a person can
// `git fetch` the agent's branches. It hands out tokens, so it needs API auth.
app.get("/api/sessions/:id/repos", async (c) => {
  if (!c.env.API_TOKEN) {
    return c.json({ error: "Set the API_TOKEN secret first: this route hands out read tokens." }, 403);
  }
  return c.json({ repos: await sessionAgent(c).shareRepos() });
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ error: error.message }, error.status);
  }
  console.error("Event Router request failed", error);
  return c.json({ error: error.message }, 500);
});
