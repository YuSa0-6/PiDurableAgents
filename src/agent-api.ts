import type { PiAgent, SharedRepo } from "./agent";
import type { EventResult, RouterEvent } from "./event";
import { MODEL_ID } from "./model";

export type EventInput = {
  readonly text?: unknown;
  readonly session?: unknown;
  readonly source?: unknown;
  readonly type?: unknown;
  readonly id?: unknown;
  readonly wait?: unknown;
};

export class HttpError extends Error {
  readonly status: 400 | 403;

  constructor(status: 400 | 403, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export class AgentApi {
  static readonly sessionPattern = /^[A-Za-z0-9_-]{1,64}$/;
  static readonly maxText = 8000;

  static readonly unauthorized =
    "Send an active Account API token as Authorization: Bearer <token>";

  static async authorize(request: Request, accountId: string): Promise<Response | null> {
    const token = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
    if (token && (await AgentApi.#isAccountToken(accountId, token))) return null;
    return Response.json(
      { error: AgentApi.unauthorized },
      { status: 401, headers: { "www-authenticate": "Bearer" } },
    );
  }

  static health() {
    return { ok: true as const, model: MODEL_ID };
  }

  static async send(
    env: Env,
    body: EventInput,
    source = "http",
  ): Promise<{ event: RouterEvent; result: EventResult }> {
    const event = AgentApi.#eventFrom(body, source);
    const result = await AgentApi.#agent(env, event.session).handleEvent(
      event,
      body.wait !== false,
    );
    return { event, result };
  }

  static async repos(env: Env, session: string): Promise<{ repos: SharedRepo[] }> {
    if (!AgentApi.sessionPattern.test(session)) throw new HttpError(400, "invalid session id");
    return { repos: await AgentApi.#agent(env, session).shareRepos() };
  }

  static async readJson(request: Request): Promise<EventInput> {
    try {
      const body: unknown = await request.json();
      if (typeof body !== "object" || body === null) throw new Error();
      return body as EventInput;
    } catch {
      throw new HttpError(400, "body must be a JSON object");
    }
  }

  static async #isAccountToken(accountId: string, token: string): Promise<boolean> {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens/verify`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (!response.ok) return false;
    const body: { result?: { status?: string } } = await response.json();
    return body.result?.status === "active";
  }

  static #eventFrom(body: EventInput, source: string): RouterEvent {
    const session = AgentApi.#textOr(body.session, "default");
    if (!AgentApi.sessionPattern.test(session)) {
      throw new HttpError(400, "session must match [A-Za-z0-9_-]{1,64}");
    }
    if (typeof body.text !== "string" || body.text.trim().length === 0) {
      throw new HttpError(400, "text (non-empty string) is required");
    }
    if (body.text.length > AgentApi.maxText) {
      throw new HttpError(400, `text must be at most ${AgentApi.maxText} characters`);
    }
    return {
      id: AgentApi.#textOr(body.id, crypto.randomUUID()),
      source: AgentApi.#textOr(body.source, source),
      type: AgentApi.#textOr(body.type, "message"),
      text: body.text,
      session,
      receivedAt: new Date().toISOString(),
    };
  }

  static #textOr(value: unknown, fallback: string): string {
    return typeof value === "string" && value.length > 0 ? value : fallback;
  }

  static #agent(env: Env, session: string): DurableObjectStub<PiAgent> {
    return (env.PiAgent as unknown as DurableObjectNamespace<PiAgent>).getByName(session);
  }
}
