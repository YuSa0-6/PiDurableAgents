export type RouterEvent = {
  readonly id: string;
  readonly source: string;
  readonly type: string;
  readonly text: string;
  readonly session: string;
  readonly receivedAt: string;
};

export type EventResult = {
  readonly status: "done" | "unanswered" | "queued";
  readonly operationId: string;
  readonly text?: string;
  readonly reason?: string;
};
