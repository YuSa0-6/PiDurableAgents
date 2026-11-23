import { ExecSandbox } from "@cloudflare/computer/remote-exec";

const SANDBOX_IDLE_MS = 2 * 60 * 1000;

export class Sandbox extends ExecSandbox<Env> {
  protected startOptions(): Record<string, unknown> {
    return { enableInternet: false };
  }

  protected override inactivityTimeoutMs(): number {
    return SANDBOX_IDLE_MS;
  }
}
