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

  static async authorize(request: Request, token: string | undefined): Promise<Response | null> {
    if (!token) return null;
    const given = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1] ?? "";
    if (!(await AgentApi.#sameSecret(given, token))) {
      return Response.json(
        { error: "Unauthorized" },
        { status: 401, headers: { "www-authenticate": "Bearer" } },
      );
    }
    return null;
  }

  static health(env: { readonly API_TOKEN?: string }) {
    return {
      ok: true as const,
      auth: env.API_TOKEN ? ("bearer" as const) : ("none" as const),
      model: MODEL_ID,
    };
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
    if (!env.API_TOKEN) {
      throw new HttpError(403, "Set the API_TOKEN secret first: this route hands out read tokens.");
    }
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

  static async #sameSecret(a: string, b: string): Promise<boolean> {
    const encoder = new TextEncoder();
    const [x, y] = await Promise.all(
      [a, b].map(
        async (value) =>
          new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))),
      ),
    );
    let diff = 0;
    for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
    return diff === 0;
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
