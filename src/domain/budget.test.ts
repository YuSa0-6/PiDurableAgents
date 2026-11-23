import { describe, expect, it } from "vite-plus/test";
import { overBudget, RUN_BUDGET, type RunUsage } from "./budget";

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
