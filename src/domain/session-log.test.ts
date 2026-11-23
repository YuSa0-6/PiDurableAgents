import { describe, expect, it } from "vite-plus/test";
import { InvalidInput } from "./errors";
import { clipText, lastSeqOf, MAX_LOG_TEXT, parseLogQuery } from "./session-log";

describe("parseLogQuery", () => {
  it("starts from the beginning with 50 entries by default", () => {
    expect(parseLogQuery({})).toEqual({ after: 0, limit: 50 });
    expect(parseLogQuery({ after: "", limit: "" })).toEqual({ after: 0, limit: 50 });
  });

  it("reads numbers and numeric strings", () => {
    expect(parseLogQuery({ after: "12", limit: 3 })).toEqual({ after: 12, limit: 3 });
  });

  it("keeps limit between 1 and 200", () => {
    expect(parseLogQuery({ limit: "0" }).limit).toBe(1);
    expect(parseLogQuery({ limit: "1000" }).limit).toBe(200);
  });

  it.each([["-1"], ["x"], ["1.5"], [Number.NaN], [true]])("rejects after %s", (after) => {
    expect(() => parseLogQuery({ after })).toThrow(InvalidInput);
  });
});

describe("lastSeqOf", () => {
  it("is the last entry's seq, or after when there are none", () => {
    expect(
      lastSeqOf(
        [
          { seq: 4, kind: "a" },
          { seq: 9, kind: "b" },
        ],
        2,
      ),
    ).toBe(9);
    expect(lastSeqOf([], 7)).toBe(7);
  });
});

describe("clipText", () => {
  it("keeps short text and marks cut text", () => {
    expect(clipText("hi")).toEqual({ text: "hi" });
    const cut = clipText("a".repeat(MAX_LOG_TEXT + 1));
    expect(cut.text).toHaveLength(MAX_LOG_TEXT);
    expect(cut.truncated).toBe(true);
  });
});
