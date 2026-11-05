import type { EntryId } from "@earendil-works/pi-durable";
import { vi } from "vitest";
import type { TranscriptMessage, TranscriptPart } from "../../protocol";
import type { usePiSession } from "../../use-pi-session";

export type ToolResultPart = Extract<TranscriptPart, { type: "tool-result" }>;
export type GapMessage = Extract<TranscriptMessage, { role: "gap" }>;
type EntryRole = Exclude<TranscriptMessage["role"], "gap">;

/** A one-pixel PNG, base64. */
export const PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

export function entry(
  role: EntryRole,
  parts: readonly TranscriptPart[],
  extra: { id?: string; error?: string } = {}
): TranscriptMessage {
  return { id: extra.id ?? `${role}-1`, role, parts, timestamp: 1, ...extra };
}

export function gap(id = "gap-1"): GapMessage {
  return {
    id,
    role: "gap",
    parts: [],
    timestamp: 0,
    after: 1 as EntryId,
    upTo: 9 as EntryId
  };
}

export function toolResult(
  overrides: Partial<ToolResultPart> = {}
): ToolResultPart {
  return {
    type: "tool-result",
    id: "call-1",
    name: "read",
    content: [{ type: "text", text: "file contents" }],
    error: false,
    ...overrides
  };
}

export type PiSession = ReturnType<typeof usePiSession>;

/** What `usePiSession` returns for an idle, connected, empty session. */
export function piSession(overrides: Partial<PiSession> = {}): PiSession {
  return {
    status: "open",
    catalog: [],
    loading: false,
    messages: [],
    earlier: false,
    live: null,
    running: false,
    tools: [],
    queued: 0,
    retry: null,
    model: null,
    error: null,
    submit: vi.fn(),
    abort: vi.fn(),
    reset: vi.fn(),
    loadEarlier: vi.fn(),
    fillGap: vi.fn(),
    ...overrides
  };
}
