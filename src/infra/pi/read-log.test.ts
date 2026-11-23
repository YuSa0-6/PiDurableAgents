import type { EntryRecord } from "@earendil-works/pi-durable";
import { describe, expect, it } from "vite-plus/test";
import { readLog, type LogSource } from "./read-log";

function source(items: EntryRecord[]): LogSource & { asked: unknown[] } {
  const asked: unknown[] = [];
  return {
    asked,
    entries: async (query, limit) => {
      asked.push({ query, limit });
      return { items };
    },
    busy: async () => true,
    pending: async () => [{ operationId: "op-1", status: "running", session: "root" } as never],
  };
}

describe("readLog", () => {
  it("asks for the entries after the given seq and keeps only the operation id and status", async () => {
    const log = source([]);
    expect(await readLog(log, { after: 7, limit: 3 })).toEqual({
      busy: true,
      pending: [{ operationId: "op-1", status: "running" }],
      entries: [],
      lastSeq: 7,
    });
    expect(log.asked).toEqual([{ query: { minEntryId: 8, order: "ascending" }, limit: 3 }]);
  });

  it("maps entries without model messages to their kind and data", async () => {
    const entry = { id: 12, kind: "app.event", data: { source: "http" } } as unknown as EntryRecord;
    const result = await readLog(source([entry]), { after: 0, limit: 50 });
    expect(result.entries).toEqual([{ seq: 12, kind: "app.event", data: { source: "http" } }]);
    expect(result.lastSeq).toBe(12);
  });
});
