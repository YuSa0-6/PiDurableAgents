import type { Message } from "@earendil-works/pi-ai";
import {
  defineTask,
  GenerationTask,
  hook,
  hookTask,
  LiveDoc,
  type AfterToolsDecision,
  type Cursor,
  type Extension,
  type HookApi,
} from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord/context";
import {
  BUDGET_UNREADABLE,
  japanDayStart,
  overBudget,
  overDailyBudget,
  spendSince,
  type BudgetLimits,
  type DailyLimits,
  type RunUsage,
  type Spend,
  type TimedSpend,
} from "../../../domain/budget";

export const BUDGET_ENTRY = "app.budget";

const SCAN_PAGE = 100;

const BudgetStop = defineTask<{ readonly reason: string }, { phase: "stop" }, AfterToolsDecision>({
  name: "budget.stop",
  version: 1,
  initial: () => ({ phase: "stop" }),
  phases: {
    stop: async (task, runtime, context) =>
      runtime.commit(async (tx) => {
        await tx.appendEntry(runtime.conversationId, {
          kind: BUDGET_ENTRY,
          data: { reason: task.input.reason },
        });
        return {
          status: "terminal",
          outcome: { status: "completed", result: { terminate: true } },
        };
      }, context),
  },
  abort: async (_task, runtime, context) =>
    runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
});

export function createBudgetExtension(
  limits: () => BudgetLimits,
  daily: () => DailyLimits,
): Extension {
  return {
    name: "budget",
    tasks: [BudgetStop],
    hooks: [
      hook(GenerationTask, {
        afterTools: async (_assistant, _results, api, context) => {
          const reason = await budgetVerdict(api, context, limits, daily);
          return reason ? { tasks: [hookTask(BudgetStop, { reason })] } : undefined;
        },
      }),
    ],
  };
}

async function budgetVerdict(
  api: HookApi,
  context: Context,
  limits: () => BudgetLimits,
  daily: () => DailyLimits,
): Promise<string | undefined> {
  try {
    return (
      overBudget(await runUsage(api, context), limits()) ??
      overDailyBudget(await todaysSpend(api, context), daily())
    );
  } catch {
    return BUDGET_UNREADABLE;
  }
}

async function runUsage(api: HookApi, context: Context): Promise<RunUsage> {
  const run = (await api.snapshot(LiveDoc, api.conversationId, context))?.run;
  const usage = { turns: run?.turns ?? 0, tokens: 0, costUsd: 0, elapsedMs: 0 };
  if (run?.first === undefined) return usage;
  let started: number | undefined;
  let cursor: Cursor | undefined;
  do {
    const page = await api.entries(
      { minEntryId: run.first, order: "ascending" },
      SCAN_PAGE,
      cursor,
      context,
    );
    for (const message of page.items.flatMap((entry) => entry.model ?? [])) {
      started ??= timestampOf(message);
      if (message.role !== "assistant") continue;
      usage.tokens += message.usage.totalTokens;
      usage.costUsd += message.usage.cost.total;
    }
    cursor = page.next;
  } while (cursor !== undefined);
  return { ...usage, elapsedMs: started === undefined ? 0 : api.now() - started };
}

async function todaysSpend(api: HookApi, context: Context): Promise<Spend> {
  const dayStart = japanDayStart(api.now());
  const spends: TimedSpend[] = [];
  let cursor: Cursor | undefined;
  let reachedYesterday = false;
  do {
    const page = await api.entries({ order: "descending" }, SCAN_PAGE, cursor, context);
    for (const message of page.items.flatMap((entry) => entry.model ?? [])) {
      if (message.timestamp < dayStart) reachedYesterday = true;
      if (message.role !== "assistant") continue;
      spends.push({
        at: message.timestamp,
        tokens: message.usage.totalTokens,
        costUsd: message.usage.cost.total,
      });
    }
    cursor = page.next;
  } while (cursor !== undefined && !reachedYesterday);
  return spendSince(dayStart, spends);
}

function timestampOf(message: Message): number | undefined {
  return "timestamp" in message ? message.timestamp : undefined;
}
