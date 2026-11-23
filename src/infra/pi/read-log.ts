import type { Message } from "@earendil-works/pi-ai";
import { ROOT_SESSION, type PiHarness } from "agents/harness/pi";
import type { Cursor, EntryId, EntryRecord, Page } from "@earendil-works/pi-durable";
import {
  clipText,
  lastSeqOf,
  type LogEntry,
  type LogMessage,
  type LogQuery,
  type PendingOperation,
  type SessionLog,
} from "../../domain/session-log";

export type LogSource = {
  entries(
    query: { readonly minEntryId?: EntryId; readonly order: "ascending" },
    limit: number,
  ): Promise<Page<EntryRecord, Cursor>>;
  busy(): Promise<boolean>;
  pending(): Promise<readonly PendingOperation[]>;
};

export function piLogSource(harness: PiHarness): LogSource {
  const session = harness.session();
  return {
    entries: (query, limit) => session.entries(query, limit),
    busy: () => session.busy(),
    pending: () => harness.pending({ session: ROOT_SESSION }),
  };
}

export async function readLog(source: LogSource, query: LogQuery): Promise<SessionLog> {
  const [page, busy, pending] = await Promise.all([
    source.entries({ minEntryId: (query.after + 1) as EntryId, order: "ascending" }, query.limit),
    source.busy(),
    source.pending(),
  ]);
  const entries = page.items.map(toLogEntry);
  return {
    busy,
    pending: pending.map(({ operationId, status }) => ({ operationId, status })),
    entries,
    lastSeq: lastSeqOf(entries, query.after),
  };
}

function toLogEntry(entry: EntryRecord): LogEntry {
  const messages = entry.model?.map(toLogMessage);
  const time = entry.model?.find((message) => "timestamp" in message)?.timestamp;
  return {
    seq: entry.id,
    kind: entry.kind,
    ...(time === undefined ? {} : { time }),
    ...(messages === undefined ? {} : { messages }),
    ...(entry.data === undefined ? {} : { data: entry.data }),
  };
}

function toLogMessage(message: Message): LogMessage {
  switch (message.role) {
    case "user":
      return { role: "user", ...clipText(textOf(message.content)) };
    case "assistant": {
      const toolCalls = message.content.flatMap((part) =>
        part.type === "toolCall" ? [part.name] : [],
      );
      return {
        role: "assistant",
        ...clipText(textOf(message.content)),
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      };
    }
    case "toolResult":
      return {
        role: "toolResult",
        toolName: message.toolName,
        isError: message.isError,
        ...clipText(textOf(message.content)),
      };
    default:
      return { role: "system", ...clipText(textOf(message.content)) };
  }
}

function textOf(
  content: string | readonly { readonly type: string; readonly text?: string }[],
): string {
  if (typeof content === "string") return content;
  return content.map((part) => (part.type === "text" ? (part.text ?? "") : "")).join("");
}
