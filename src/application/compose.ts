import type { PiAgent } from "./pi-agent";
import { CloudflareAccountToken } from "../infra/auth/cloudflare-account-token";
import { DurableAgentGateway } from "../infra/durable/durable-agent-gateway";
import { randomIds, systemClock } from "../infra/system";
import { MODEL_ID } from "../infra/llm/openrouter";
import type { AgentGateway } from "../usecase/ports/agent-gateway";
import type { Authenticator } from "../usecase/ports/authenticator";
import type { Clock } from "../usecase/ports/clock";
import type { Ids } from "../usecase/ports/ids";

export type App = {
  readonly agents: AgentGateway;
  readonly auth: Authenticator;
  readonly skipAuthOnLocalhost: boolean;
  readonly clock: Clock;
  readonly ids: Ids;
  readonly model: string;
};

type LocalDevVars = { readonly SKIP_AUTH_ON_LOCALHOST?: string };

export function compose(env: Env): App {
  return {
    agents: new DurableAgentGateway(env.PiAgent as unknown as DurableObjectNamespace<PiAgent>),
    auth: new CloudflareAccountToken(env.ACCOUNT_ID),
    skipAuthOnLocalhost: (env as LocalDevVars).SKIP_AUTH_ON_LOCALHOST === "1",
    clock: systemClock,
    ids: randomIds,
    model: MODEL_ID,
  };
}
