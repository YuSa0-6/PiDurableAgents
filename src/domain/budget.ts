export type RunUsage = {
  readonly turns: number;
  readonly tokens: number;
  readonly costUsd: number;
  readonly elapsedMs: number;
};

export type BudgetLimits = RunUsage;

export const RUN_BUDGET: BudgetLimits = {
  turns: 20,
  tokens: 1_500_000,
  costUsd: 0.3,
  elapsedMs: 10 * 60 * 1000,
};

const LABELS: Record<keyof RunUsage, string> = {
  turns: "tool rounds",
  tokens: "tokens",
  costUsd: "cost in USD",
  elapsedMs: "elapsed milliseconds",
};

export function overBudget(usage: RunUsage, limits: BudgetLimits): string | undefined {
  const keys = Object.keys(LABELS) as (keyof RunUsage)[];
  const over = keys.find((key) => usage[key] >= limits[key]);
  return over === undefined
    ? undefined
    : `Run budget reached: ${LABELS[over]} ${usage[over]} of ${limits[over]}.`;
}
