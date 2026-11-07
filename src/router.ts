import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import {
  DECISION_MODEL,
  decide,
  MIN_CONFIDENCE,
  type RouterEvent
} from "./decision-model";
import {
  DEFAULT_MODEL,
  EXECUTION_MODELS,
  isExecutionModel,
  type ExecutionModelId
} from "./models";

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

export const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", cors());

app.get("/api/health", (c) =>
  c.json({
    ok: true,
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
  const agent = c.env.PiAgent.getByName(event.session);
  const result = await agent.handleEvent(event, decision, body.wait !== false);
  return c.json({ event, decision, result });
});

app.get("/api/sessions/:id/decisions", async (c) => {
  const id = c.req.param("id");
  if (!SESSION_PATTERN.test(id)) throw badRequest("invalid session id");
  const agent = c.env.PiAgent.getByName(id);
  return c.json({ decisions: await agent.decisions(50) });
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ error: error.message }, error.status);
  }
  console.error("Event Router request failed", error);
  return c.json({ error: error.message }, 500);
});
