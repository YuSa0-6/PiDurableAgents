import type { PiSubmitOptions } from "agents/harness/pi";
import type { EventResult, RouterEvent } from "./event";

type SessionRunner = {
  prompt(input: string, options?: PiSubmitOptions): Promise<EventResult>;
  submit(input: string, options?: PiSubmitOptions): Promise<{ readonly operationId: string }>;
};

export class EventSession {
  static async run(session: SessionRunner, event: RouterEvent, wait = true): Promise<EventResult> {
    const options: PiSubmitOptions = {
      operationId: event.id,
      entry: { kind: "app.event", data: { source: event.source, type: event.type } },
    };
    if (!wait) {
      const receipt = await session.submit(event.text, options);
      return { status: "queued", operationId: receipt.operationId };
    }
    const { status, text, reason, operationId } = await session.prompt(event.text, options);
    return { status, operationId, text, reason };
  }
}
