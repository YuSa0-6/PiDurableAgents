import {
  DEFAULT_MODEL,
  EXECUTION_MODELS,
  isExecutionModel,
  type ExecutionModelId
} from "./execution-models";
import type { RouterEvent } from "./event";

type DecidedBy = "guardrail" | "d1.1" | "fallback" | "override";

export type Decision = {
  readonly action: "llm" | "reject";
  readonly model: ExecutionModelId | "";
  readonly decidedBy: DecidedBy;
  readonly confidence: number;
  readonly probabilities?: Readonly<Record<string, number>>;
  readonly reasons: readonly string[];
  readonly costUsd?: number;
  readonly latencyMs: number;
};

export const DECISION_MODEL = "liquid/d1.1";

export const MIN_CONFIDENCE = 0.4;

const MAX_TEXT = 8000;
const DECISION_TIMEOUT_MS = 5000;

const BLOCKED: readonly RegExp[] = [
  /ignore (all|previous) instructions/i,
  /(system prompt|システムプロンプト)を(表示|出力|教えて)/
];

export type DecisionEnv = {
  readonly AI: Ai;
  readonly AI_GATEWAY_ID: string;
};

type ChoiceAnswer = {
  readonly type: "choice";
  readonly choice: string;
  readonly probabilities: Record<string, number>;
  readonly confidence: number;
};

type DecisionsResponse = {
  readonly model?: string;
  readonly answers?: { readonly model?: ChoiceAnswer };
  readonly usage?: { readonly cost?: number };
  readonly error?: { readonly message?: string };
};

async function askD1(env: DecisionEnv, event: RouterEvent) {
  const body = {
    model: DECISION_MODEL,
    state: {
      request: event.text.slice(0, 4000),
      source: event.source,
      type: event.type
    },
    questions: {
      model: {
        type: "choice",
        instructions:
          "Pick the model that should handle this request: the cheapest one that can do it well.",
        criteria: Object.fromEntries(
          EXECUTION_MODELS.map((model) => [model.id, model.criteria])
        )
      }
    }
  };
  const response = await env.AI.gateway(env.AI_GATEWAY_ID).run(
    {
      provider: "openrouter",
      endpoint: "../alpha/decisions",
      headers: { "content-type": "application/json" },
      query: body
    },
    { signal: AbortSignal.timeout(DECISION_TIMEOUT_MS) }
  );
  const json = (await response.json()) as DecisionsResponse;
  if (!response.ok) {
    throw new Error(
      `d1.1 answered ${response.status}: ${json.error?.message ?? "no message"}`
    );
  }
  const answer = json.answers?.model;
  if (answer?.type !== "choice") throw new Error("d1.1 gave no choice");
  return { answer, version: json.model, cost: json.usage?.cost };
}

function reject(reason: string, started: number): Decision {
  return {
    action: "reject",
    model: "",
    decidedBy: "guardrail",
    confidence: 1,
    reasons: [reason],
    latencyMs: Date.now() - started
  };
}

function fallback(reason: string, started: number, extra: Partial<Decision> = {}): Decision {
  return {
    action: "llm",
    model: DEFAULT_MODEL,
    decidedBy: "fallback",
    confidence: 0,
    ...extra,
    reasons: [...(extra.reasons ?? []), reason, `fallback → ${DEFAULT_MODEL}`],
    latencyMs: Date.now() - started
  };
}

export async function decide(
  env: DecisionEnv,
  event: RouterEvent,
  override?: ExecutionModelId
): Promise<Decision> {
  const started = Date.now();
  const text = event.text.trim();

  if (text.length === 0) return reject("guardrail: empty text", started);
  if (text.length > MAX_TEXT) {
    return reject(`guardrail: text longer than ${MAX_TEXT} chars`, started);
  }
  const blocked = BLOCKED.find((pattern) => pattern.test(text));
  if (blocked) return reject(`guardrail: matched ${blocked}`, started);

  if (override) {
    return {
      action: "llm",
      model: override,
      decidedBy: "override",
      confidence: 1,
      reasons: [`override: ${override}`],
      latencyMs: Date.now() - started
    };
  }

  let result: Awaited<ReturnType<typeof askD1>>;
  try {
    result = await askD1(env, event);
  } catch (error) {
    console.warn("DecisionModel: d1.1 failed", error);
    const message = error instanceof Error ? error.message : String(error);
    return fallback(`d1.1 failed: ${message}`, started);
  }
  const { answer, version, cost } = result;
  const seen = {
    probabilities: answer.probabilities,
    costUsd: cost,
    reasons: [`${version ?? DECISION_MODEL}: ${answer.choice} (confidence ${answer.confidence.toFixed(2)})`]
  };

  if (!isExecutionModel(answer.choice)) {
    return fallback("d1.1 chose a model outside the pool", started, seen);
  }
  if (answer.confidence < MIN_CONFIDENCE) {
    return fallback(`confidence below ${MIN_CONFIDENCE}`, started, {
      ...seen,
      confidence: answer.confidence
    });
  }
  return {
    action: "llm",
    model: answer.choice,
    decidedBy: "d1.1",
    confidence: answer.confidence,
    ...seen,
    latencyMs: Date.now() - started
  };
}
