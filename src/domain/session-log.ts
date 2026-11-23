import { InvalidInput } from "./errors";

export const DEFAULT_LOG_LIMIT = 50;
export const MAX_LOG_LIMIT = 200;
export const MAX_LOG_TEXT = 4000;

export type LogQuery = {
  readonly after: number;
  readonly limit: number;
};

export type LogQueryInput = {
  readonly after?: unknown;
  readonly limit?: unknown;
};

export type LogMessage = {
  readonly role: "system" | "user" | "assistant" | "toolResult";
  readonly text: string;
  readonly toolName?: string;
  readonly toolCalls?: readonly string[];
  readonly isError?: boolean;
  readonly truncated?: true;
};

export type LogEntry = {
  readonly seq: number;
  readonly kind: string;
  readonly time?: number;
  readonly messages?: readonly LogMessage[];
  readonly data?: unknown;
};

export type PendingOperation = {
  readonly operationId: string;
  readonly status: "queued" | "running";
};

export type SessionLog = {
  readonly busy: boolean;
  readonly pending: readonly PendingOperation[];
  readonly entries: readonly LogEntry[];
  readonly lastSeq: number;
};

export function parseLogQuery(input: LogQueryInput): LogQuery {
  return {
    after: wholeNumber(input.after, "after", 0),
    limit: Math.min(
      Math.max(wholeNumber(input.limit, "limit", DEFAULT_LOG_LIMIT), 1),
      MAX_LOG_LIMIT,
    ),
  };
}

export function lastSeqOf(entries: readonly LogEntry[], after: number): number {
  return entries.at(-1)?.seq ?? after;
}

export function clipText(text: string): { readonly text: string; readonly truncated?: true } {
  return text.length > MAX_LOG_TEXT
    ? { text: text.slice(0, MAX_LOG_TEXT), truncated: true }
    : { text };
}

function wholeNumber(value: unknown, name: string, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new InvalidInput(`${name} must be a whole number of 0 or more`);
  }
  return parsed;
}
