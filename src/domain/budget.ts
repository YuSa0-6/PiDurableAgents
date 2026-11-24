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

export const BUDGET_UNREADABLE = "Run budget could not be read, so the run stops.";

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

export type Spend = {
  readonly tokens: number;
  readonly costUsd: number;
};

export type TimedSpend = Spend & { readonly at: number };

export type DailyLimits = Spend;

export const SESSION_DAILY_BUDGET: DailyLimits = {
  tokens: Number.MAX_SAFE_INTEGER,
  costUsd: 3,
};

const DAY_MS = 24 * 60 * 60 * 1000;
const JAPAN_OFFSET_MS = 9 * 60 * 60 * 1000;

export function japanDayStart(now: number): number {
  return now - ((((now + JAPAN_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS);
}

export function spendSince(dayStart: number, spends: readonly TimedSpend[]): Spend {
  return spends
    .filter((spend) => spend.at >= dayStart)
    .reduce(
      (total, spend) => ({
        tokens: total.tokens + spend.tokens,
        costUsd: total.costUsd + spend.costUsd,
      }),
      { tokens: 0, costUsd: 0 },
    );
}

export function overDailyBudget(spend: Spend, limits: DailyLimits): string | undefined {
  const keys = ["costUsd", "tokens"] as const;
  const over = keys.find((key) => spend[key] >= limits[key]);
  return over === undefined
    ? undefined
    : `Daily session budget reached: ${LABELS[over]} ${spend[over]} of ${limits[over]}. It resets at midnight Japan time.`;
}
