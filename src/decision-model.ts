/**
 * DecisionModel: decides which execution model answers one event, before
 * any large model runs.
 *
 *   RouterEvent ──▶ 1. guardrails (rules)        ──▶ reject?
 *               ──▶ 2. Liquid d1.1 (OpenRouter) ──▶ model + probabilities
 *               ──▶ 3. fallback (DEFAULT_MODEL) when d1.1 fails or is unsure
 *
 * d1.1 is a decisions model: it does not chat. It reads a `state` and answers
 * typed `questions`. Here it answers one `choice` question whose options are
 * the execution models in `EXECUTION_MODELS`, each with its `criteria`.
 */
import {
  DEFAULT_MODEL,
  EXECUTION_MODELS,
  isExecutionModel,
  type ExecutionModelId
} from "./models";

/** Which step made the decision. */
export type DecidedBy = "guardrail" | "d1.1" | "fallback" | "override";

export type Decision = {
  /** `llm`: hand the event to the Pi agent. `reject`: answer with an error. */
  readonly action: "llm" | "reject";
  /** The OpenRouter model the Pi agent answers with. */
  readonly model: ExecutionModelId | "";
  readonly decidedBy: DecidedBy;
  /** 0..1, as d1.1 reports it. */
  readonly confidence: number;
  /** d1.1's probability for each execution model. */
  readonly probabilities?: Readonly<Record<string, number>>;
  readonly reasons: readonly string[];
  /** What d1.1 cost, in USD. */
  readonly costUsd?: number;
  readonly latencyMs: number;
};

/** The event as the router normalised it. */
export type RouterEvent = {
  /** Idempotency key: the same id is answered once. */
  readonly id: string;
  /** Where the event came from, e.g. `http`, `webhook`. */
  readonly source: string;
  /** Free-form event type, e.g. `message`, `github.issue`. */
  readonly type: string;
  /** The text the agent should act on. */
  readonly text: string;
  /** The Durable Object (one Pi session per object) the event goes to. */
  readonly session: string;
  readonly receivedAt: string;
};

/** The decisions model, on OpenRouter. */
export const DECISION_MODEL = "liquid/d1.1";

/** Below this confidence the fallback model answers instead. */
export const MIN_CONFIDENCE = 0.4;

const MAX_TEXT = 8000;
const DECISION_TIMEOUT_MS = 5000;

const BLOCKED: readonly RegExp[] = [
  /ignore (all|previous) instructions/i,
  /(system prompt|システムプロンプト)を(表示|出力|教えて)/
];

/** What `decide` needs: the AI binding and the gateway that holds the key. */
export type DecisionEnv = {
  readonly AI: Ai;
  readonly AI_GATEWAY_ID: string;
};

/** d1.1's answer to a `choice` question. */
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

/**
 * Ask d1.1 which execution model fits the event.
 *
 * OpenRouter serves decisions models on `/api/alpha/decisions`, beside
 * `/api/v1`. AI Gateway's OpenRouter provider is rooted at `/api/v1`, so the
 * endpoint is `../alpha/decisions`. The endpoint is an alpha: if OpenRouter
 * moves it, this call fails and the fallback model answers.
 */
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

/**
 * Decide how to handle one event. Never throws. `override` names an
 * execution model to use instead of asking d1.1 (guardrails still apply).
 */
export async function decide(
  env: DecisionEnv,
  event: RouterEvent,
  override?: ExecutionModelId
): Promise<Decision> {
  const started = Date.now();
  const text = event.text.trim();

  // 1. Guardrails.
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

  // 2. d1.1.
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

  // 3. Fallback when d1.1 is unsure or picks something outside the pool.
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
