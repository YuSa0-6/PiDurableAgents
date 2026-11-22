import { describe, expect, it } from "vite-plus/test";
import { InvalidInput } from "./errors";
import { MAX_EVENT_TEXT, parseEvent, waitsForAnswer } from "./event";

const defaults = { id: "generated", source: "http", receivedAt: "2026-11-22T00:00:00.000Z" };

describe("parseEvent", () => {
  it("fills defaults around the text", () => {
    expect(parseEvent({ text: "hi" }, defaults)).toEqual({
      id: "generated",
      source: "http",
      type: "message",
      text: "hi",
      session: "default",
      receivedAt: "2026-11-22T00:00:00.000Z",
    });
  });

  it("keeps the caller's fields and treats empty strings as missing", () => {
    expect(
      parseEvent({ text: "hi", id: "e1", source: "mcp", type: "push", session: "s_1-A" }, defaults),
    ).toMatchObject({ id: "e1", source: "mcp", type: "push", session: "s_1-A" });
    expect(
      parseEvent({ text: "hi", id: "", source: "", type: "", session: "" }, defaults),
    ).toMatchObject({ id: "generated", source: "http", type: "message", session: "default" });
  });

  it.each([
    [{ text: "hi", session: "a/b" }, "session must match [A-Za-z0-9_-]{1,64}"],
    [{ session: "a/b" }, "session must match [A-Za-z0-9_-]{1,64}"],
    [{ text: "hi", session: "s".repeat(65) }, "session must match [A-Za-z0-9_-]{1,64}"],
    [{}, "text (non-empty string) is required"],
    [{ text: 1 }, "text (non-empty string) is required"],
    [{ text: "  " }, "text (non-empty string) is required"],
    [{ text: "x".repeat(MAX_EVENT_TEXT + 1) }, "text must be at most 8000 characters"],
  ])("rejects %j", (input, message) => {
    expect(() => parseEvent(input, defaults)).toThrow(new InvalidInput(message));
  });

  it("accepts text at the limit", () => {
    expect(parseEvent({ text: "x".repeat(MAX_EVENT_TEXT) }, defaults).text).toHaveLength(8000);
  });
});

describe("waitsForAnswer", () => {
  it("waits unless wait is exactly false", () => {
    expect(waitsForAnswer({})).toBe(true);
    expect(waitsForAnswer({ wait: "false" })).toBe(true);
    expect(waitsForAnswer({ wait: false })).toBe(false);
  });
});
