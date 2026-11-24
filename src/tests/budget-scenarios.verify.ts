import { env } from "cloudflare:workers";
import { describe, expect, it } from "vite-plus/test";
import { BUDGET_ENTRY } from "../infra/pi/extensions/budget";
import type { TranscriptEntry } from "./worker";

type Plan = `plan ${number} ${"answer" | "error"}`;
type Delivery = "after" | "queued";
type Limits = { readonly turns: number; readonly tokens: number; readonly dailyTokens: number };
type Scenario = {
  readonly runs: readonly Plan[];
  readonly delivery: Delivery;
  readonly limits: Limits;
};

const UNLIMITED = Number.MAX_SAFE_INTEGER;
const PLANS: readonly Plan[] = [0, 1, 2, 3].flatMap((rounds) => [
  `plan ${rounds} answer` as const,
  `plan ${rounds} error` as const,
]);
const LIMITS: readonly Limits[] = [
  ...[1, 2, 3].map((turns) => ({ turns, tokens: UNLIMITED, dailyTokens: UNLIMITED })),
  ...[1, 7_000, 13_500].map((tokens) => ({ turns: UNLIMITED, tokens, dailyTokens: UNLIMITED })),
  { turns: 2, tokens: 7_000, dailyTokens: UNLIMITED },
  ...[7_000, 20_000].map((dailyTokens) => ({ turns: UNLIMITED, tokens: UNLIMITED, dailyTokens })),
  { turns: UNLIMITED, tokens: UNLIMITED, dailyTokens: UNLIMITED },
];

function scenarios(): Scenario[] {
  const sequences: { runs: Plan[]; delivery: Delivery }[] = [
    ...PLANS.map((plan) => ({ runs: [plan], delivery: "after" as const })),
    ...PLANS.flatMap((first) =>
      PLANS.flatMap((second) =>
        (["after", "queued"] as const)
          .filter((delivery) => delivery === "after" || first !== "plan 0 error")
          .map((delivery) => ({ runs: [first, second], delivery })),
      ),
    ),
  ];
  return sequences.flatMap((sequence) => LIMITS.map((limits) => ({ ...sequence, limits })));
}

type Played = {
  readonly transcript: readonly TranscriptEntry[];
  readonly settled: boolean;
};

function budgetViolations(scenario: Scenario, played: Played): string[] {
  const runs: TranscriptEntry[][] = [];
  for (const entry of played.transcript) {
    if (entry.kind === "pi.user") runs.push([]);
    runs.at(-1)?.push(entry);
  }
  const expected = scenario.runs.length;
  const whole = [
    ...(played.settled ? [] : ["the agent was still busy when the scenario gave up waiting"]),
    ...(runs.length === expected
      ? []
      : [`expected ${expected} runs but the log has ${runs.length}`]),
  ];
  return [
    ...whole,
    ...runs.flatMap((run, index) =>
      runViolations(
        run,
        scenario.limits,
        plannedRounds(scenario.runs[index]),
        runs
          .slice(0, index)
          .flat()
          .reduce((sum, entry) => sum + tokensOf(entry), 0),
      ).map((v) => `run ${index + 1}: ${v}`),
    ),
  ];
}

function tokensOf(entry: TranscriptEntry): number {
  return entry.messages.reduce(
    (sum, message) => sum + ("tokens" in message ? message.tokens : 0),
    0,
  );
}

function plannedRounds(plan: Plan | undefined): number {
  return Number(plan?.split(" ")[1] ?? 0);
}

function stoppedBy(played: Played): boolean {
  return played.transcript.some((entry) => entry.kind === BUDGET_ENTRY);
}

function runViolations(
  run: readonly TranscriptEntry[],
  limits: Limits,
  planned: number,
  spentEarlierToday: number,
): string[] {
  let rounds = 0;
  let tokens = 0;
  let stopAt: number | undefined;
  let pendingRound = false;
  const violations: string[] = [];
  run.forEach((entry, position) => {
    if (stopAt !== undefined && position > stopAt && entry.kind === "pi.assistant") {
      violations.push(`model called again after the round that reached a limit (entry ${stopAt})`);
    }
    for (const message of entry.messages) {
      if ("tokens" in message) tokens += message.tokens;
      if ("stopReason" in message && message.stopReason === "toolUse") pendingRound = true;
    }
    const roundEnds =
      pendingRound &&
      entry.kind === "pi.tool-result" &&
      run[position + 1]?.kind !== "pi.tool-result";
    if (!roundEnds) return;
    pendingRound = false;
    rounds += 1;
    if (
      stopAt === undefined &&
      (rounds >= limits.turns ||
        tokens >= limits.tokens ||
        spentEarlierToday + tokens >= limits.dailyTokens)
    ) {
      stopAt = position + 1;
      if (run[stopAt]?.kind !== BUDGET_ENTRY) {
        violations.push(
          `round ${rounds} reached ${rounds} rounds and ${tokens} tokens but the next entry is ${run[stopAt]?.kind ?? "missing"}, not ${BUDGET_ENTRY}`,
        );
      }
    }
  });
  const stops = run.flatMap((entry, position) => (entry.kind === BUDGET_ENTRY ? [position] : []));
  if (stopAt === undefined && stops.length > 0) {
    violations.push(`stopped at entry ${stops[0]! + 1} with ${rounds} rounds and ${tokens} tokens`);
  }
  if (stops.length > 1) violations.push(`${stops.length} budget entries`);
  if (stopAt === undefined && rounds !== planned) {
    violations.push(`planned ${planned} tool rounds but the run played ${rounds}`);
  }
  return violations;
}

async function idle(agent: { busy(): Promise<boolean> }): Promise<boolean> {
  for (let attempt = 0; attempt < 1000; attempt++) {
    if (!(await agent.busy())) return true;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return false;
}

async function play(scenario: Scenario): Promise<Played> {
  const agent = env.PI_HARNESS_TEST.getByName(crypto.randomUUID());
  const { dailyTokens, ...run } = scenario.limits;
  await agent.setBudget({ ...run, costUsd: UNLIMITED, elapsedMs: UNLIMITED });
  await agent.setDailyBudget({ tokens: dailyTokens, costUsd: UNLIMITED });
  await agent.writeWorkspaceFile("/workspace/note.txt", "hello");
  let settled = true;
  for (const plan of scenario.runs) {
    await agent.submit(plan);
    if (scenario.delivery === "after") settled = (await idle(agent)) && settled;
  }
  settled = (await idle(agent)) && settled;
  return { transcript: await agent.transcript(), settled };
}

describe("run budget over every scripted scenario", () => {
  it("stops each run exactly at the first tool round that reaches a limit", async () => {
    const all = scenarios();
    const found: string[] = [];
    const stoppingLimits = new Set<Limits>();
    for (let start = 0; start < all.length; start += 32) {
      const batch = all.slice(start, start + 32);
      const played = await Promise.all(batch.map(play));
      batch.forEach((scenario, index) => {
        if (stoppedBy(played[index]!)) stoppingLimits.add(scenario.limits);
        for (const violation of budgetViolations(scenario, played[index]!)) {
          found.push(`${JSON.stringify(scenario)} -> ${violation}`);
        }
      });
    }
    expect(found.slice(0, 10)).toEqual([]);
    expect(LIMITS.filter((limits) => !stoppingLimits.has(limits))).toEqual([
      { turns: UNLIMITED, tokens: UNLIMITED, dailyTokens: UNLIMITED },
    ]);
  }, 900_000);
});
