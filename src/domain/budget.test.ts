import { describe, expect, it } from "vite-plus/test";
import {
  japanDayStart,
  overBudget,
  overDailyBudget,
  RUN_BUDGET,
  SESSION_DAILY_BUDGET,
  spendSince,
  type RunUsage,
} from "./budget";

const fresh: RunUsage = { turns: 0, tokens: 0, costUsd: 0, elapsedMs: 0 };

describe("overBudget", () => {
  it("lets a run inside every limit go on", () => {
    expect(overBudget(fresh, RUN_BUDGET)).toBeUndefined();
    expect(
      overBudget({ turns: 19, tokens: 1_499_999, costUsd: 0.29, elapsedMs: 599_999 }, RUN_BUDGET),
    ).toBeUndefined();
  });

  it.each([
    [{ turns: 20 }, "Run budget reached: tool rounds 20 of 20."],
    [{ tokens: 1_500_000 }, "Run budget reached: tokens 1500000 of 1500000."],
    [{ costUsd: 0.3 }, "Run budget reached: cost in USD 0.3 of 0.3."],
    [{ elapsedMs: 600_000 }, "Run budget reached: elapsed milliseconds 600000 of 600000."],
  ])("stops a run that reaches %o", (reached, reason) => {
    expect(overBudget({ ...fresh, ...reached }, RUN_BUDGET)).toBe(reason);
  });
});

describe("daily session budget", () => {
  const midnightJst = 1_795_446_000_000;

  it("starts the day at midnight Japan time", () => {
    expect(japanDayStart(midnightJst)).toBe(midnightJst);
    expect(japanDayStart(midnightJst - 1)).toBe(midnightJst - 24 * 60 * 60 * 1000);
    expect(japanDayStart(midnightJst + 23 * 60 * 60 * 1000)).toBe(midnightJst);
  });

  it("counts only what was spent since the day started", () => {
    expect(
      spendSince(midnightJst, [
        { at: midnightJst - 1, tokens: 100, costUsd: 2 },
        { at: midnightJst, tokens: 10, costUsd: 1 },
        { at: midnightJst + 5, tokens: 20, costUsd: 0.5 },
      ]),
    ).toEqual({ tokens: 30, costUsd: 1.5 });
  });

  it("stops a session that reaches its daily limit", () => {
    expect(overDailyBudget({ tokens: 0, costUsd: 2.99 }, SESSION_DAILY_BUDGET)).toBeUndefined();
    expect(overDailyBudget({ tokens: 0, costUsd: 3 }, SESSION_DAILY_BUDGET)).toBe(
      "Daily session budget reached: cost in USD 3 of 3. It resets at midnight Japan time.",
    );
  });
});
