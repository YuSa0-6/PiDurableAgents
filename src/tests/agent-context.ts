import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";

export function agentContext(): ExecutionContext {
  const ctx = createExecutionContext();
  Object.defineProperty(ctx, "exports", { value: { PiAgent: env.PI_HARNESS_TEST } });
  return ctx;
}
