/** The event as the router normalised it. */
export type RouterEvent = {
  /** Idempotency key: the same id is answered once. */
  readonly id: string;
  /** Where the event came from, e.g. `http`, `webhook`. */
  readonly source: string;
  /** Free-form event type, e.g. `message`, `github.issue`. */
  readonly type: string;
  /** The text the agent should act on. */
  readonly text: string;
  /** The Durable Object (one Pi session per object) the event goes to. */
  readonly session: string;
  readonly receivedAt: string;
};
