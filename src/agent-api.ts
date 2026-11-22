import type { PiAgent } from "./agent";
import { InvalidInput } from "./domain/errors";
import {
  parseEvent,
  waitsForAnswer,
  type AgentEvent,
  type EventInput,
  type EventResult,
} from "./domain/event";
import { isSessionId, type SessionId } from "./domain/session-id";
import type { SharedRepo } from "./domain/shared-repo";
import { MODEL_ID } from "./model";

export class AgentApi {
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
  ): Promise<{ event: AgentEvent; result: EventResult }> {
    const event = parseEvent(body, {
      id: crypto.randomUUID(),
      source,
      receivedAt: new Date().toISOString(),
    });
    const result = await AgentApi.#agent(env, event.session).handleEvent(
      event,
      waitsForAnswer(body),
    );
    return { event, result };
  }

  static async repos(env: Env, session: string): Promise<{ repos: SharedRepo[] }> {
    if (!isSessionId(session)) throw new InvalidInput("invalid session id");
    return { repos: await AgentApi.#agent(env, session).shareRepos() };
  }

  static async readJson(request: Request): Promise<EventInput> {
    try {
      const body: unknown = await request.json();
      if (typeof body !== "object" || body === null) throw new Error();
      return body as EventInput;
    } catch {
      throw new InvalidInput("body must be a JSON object");
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

  static #agent(env: Env, session: SessionId): DurableObjectStub<PiAgent> {
    return (env.PiAgent as unknown as DurableObjectNamespace<PiAgent>).getByName(session);
  }
}
