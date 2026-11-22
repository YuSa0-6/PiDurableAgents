import type { PiAgent } from "./agent";
import { CloudflareAccountToken } from "./infra/auth/cloudflare-account-token";
import { DurableAgentGateway } from "./infra/durable/durable-agent-gateway";
import { randomIds, systemClock } from "./infra/system";
import { MODEL_ID } from "./model";
import type { AgentGateway } from "./usecase/ports/agent-gateway";
import type { Authenticator } from "./usecase/ports/authenticator";
import type { Clock } from "./usecase/ports/clock";
import type { Ids } from "./usecase/ports/ids";

export type App = {
  readonly agents: AgentGateway;
  readonly auth: Authenticator;
  readonly clock: Clock;
  readonly ids: Ids;
  readonly model: string;
};

export function compose(env: Env): App {
  return {
    agents: new DurableAgentGateway(env.PiAgent as unknown as DurableObjectNamespace<PiAgent>),
    auth: new CloudflareAccountToken(env.ACCOUNT_ID),
    clock: systemClock,
    ids: randomIds,
    model: MODEL_ID,
  };
}
