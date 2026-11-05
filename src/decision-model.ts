/**
 * DecisionModel: decides how the Pi agent should handle one event, before any
 * large model runs.
 *
 *   RouterEvent ──▶ 1. guardrails (rules)   ──▶ reject?
 *               ──▶ 2. intent rules (keywords) ──▶ clear winner? ──▶ policy
 *               ──▶ 3. small LLM classifier  ──▶ intent        ──▶ policy
 *               ──▶ 4. fallback ("chat")                         ──▶ policy
 *
 * The policy table maps the chosen intent to the LLM the Pi harness uses for
 * the answer. The decision is plain JSON, so the router can return it, the
 * Durable Object can log it, and a client can show it.
 */

/** What the event asks for. */
export type Intent = "chat" | "workspace" | "analysis";

/** Which step made the decision. */
export type DecidedBy = "guardrail" | "rules" | "classifier" | "fallback";

export type Decision = {
  /** `llm`: hand the event to the Pi agent. `reject`: answer with an error. */
  readonly action: "llm" | "reject";
  readonly intent: Intent;
  /** The Workers AI model the Pi agent answers with. */
  readonly model: string;
  readonly decidedBy: DecidedBy;
  /** 0..1. Rules give 1 for a clear match; the classifier reports its own. */
  readonly confidence: number;
  readonly reasons: readonly string[];
  readonly latencyMs: number;
};

/** The event as the router normalised it. */
export type RouterEvent = {
  /** Idempotency key: the same id is answered once. */
  readonly id: string;
  /** Where the event came from, e.g. `http`, `websocket`, `webhook`. */
  readonly source: string;
  /** Free-form event type, e.g. `message`, `github.issue`. */
  readonly type: string;
  /** The text the agent should act on. */
  readonly text: string;
  /** The Durable Object (one Pi session per object) the event goes to. */
  readonly session: string;
  readonly receivedAt: string;
};

/** Intent → which LLM answers. Edit this table to change the routing. */
export const POLICY: Record<Intent, { model: string; description: string }> = {
  chat: {
    model: "@cf/zai-org/glm-5.3-flash",
    description: "Short questions and small talk: the fast model."
  },
  workspace: {
    model: "@cf/zai-org/glm-5.3-flash",
    description: "File and code work in /workspace: the fast model with tools."
  },
  analysis: {
    model: "@cf/zai-org/glm-5.3",
    description: "Design, comparison and multi-step reasoning: the larger model."
  }
};

/** The small model that classifies events the rules cannot place. */
export const CLASSIFIER_MODEL = "@cf/meta/llama-3.2-3b-instruct";

const MAX_TEXT = 8000;
const CLASSIFIER_TIMEOUT_MS = 5000;

/** Keyword rules, English and Japanese. Each hit adds one point. */
const KEYWORDS: Record<Exclude<Intent, "chat">, readonly RegExp[]> = {
  workspace: [
    /\/workspace/i,
    /\b(file|files|read|write|edit|delete|ls|grep|exec|run|script|javascript|git|clone|repo)\b/i,
    /(ファイル|保存|書き込|読み込|読んで|書いて|削除|実行|スクリプト|クローン|リポジトリ)/
  ],
  analysis: [
    /\b(analy[sz]e|compare|design|architecture|plan|trade-?offs?|why|evaluate|pros|cons|strategy)\b/i,
    /(分析|比較|設計|アーキテクチャ|計画|なぜ|理由|評価|メリット|デメリット|戦略|検討)/,
    /(step by step|ステップ|段階的)/i
  ]
};

const BLOCKED: readonly RegExp[] = [
  /ignore (all|previous) instructions/i,
  /(system prompt|システムプロンプト)を(表示|出力|教えて)/
];

type Scores = Record<Exclude<Intent, "chat">, number>;

function score(text: string): Scores {
  const scores: Scores = { workspace: 0, analysis: 0 };
  for (const intent of Object.keys(KEYWORDS) as (keyof Scores)[]) {
    for (const pattern of KEYWORDS[intent]) {
      if (pattern.test(text)) scores[intent] += 1;
    }
  }
  return scores;
}

function decision(
  intent: Intent,
  decidedBy: DecidedBy,
  confidence: number,
  reasons: string[],
  started: number
): Decision {
  return {
    action: "llm",
    intent,
    model: POLICY[intent].model,
    decidedBy,
    confidence,
    reasons: [...reasons, `policy: ${intent} → ${POLICY[intent].model}`],
    latencyMs: Date.now() - started
  };
}

function reject(reason: string, started: number): Decision {
  return {
    action: "reject",
    intent: "chat",
    model: "",
    decidedBy: "guardrail",
    confidence: 1,
    reasons: [reason],
    latencyMs: Date.now() - started
  };
}

/** Ask a small model for the intent. Returns undefined on any failure. */
async function classify(
  ai: Ai,
  text: string
): Promise<{ intent: Intent; confidence: number } | undefined> {
  const prompt = [
    "Classify the user's request into exactly one intent.",
    '- "workspace": reading, writing or running files or code, or git.',
    '- "analysis": design, comparison, planning or multi-step reasoning.',
    '- "chat": anything else, such as a short question or small talk.',
    'Reply with JSON only, like {"intent":"chat","confidence":0.8}.'
  ].join("\n");
  const timeout = new Promise<undefined>((resolve) =>
    setTimeout(() => resolve(undefined), CLASSIFIER_TIMEOUT_MS)
  );
  const run = (async (): Promise<{ intent: Intent; confidence: number } | undefined> => {
    const output = (await ai.run(CLASSIFIER_MODEL, {
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: text.slice(0, 2000) }
      ],
      max_tokens: 40,
      temperature: 0
    })) as { response?: unknown };
    const raw =
      typeof output.response === "string"
        ? output.response
        : JSON.stringify(output.response ?? "");
    const json = /\{[\s\S]*?\}/.exec(raw)?.[0];
    if (!json) return undefined;
    const parsed = JSON.parse(json) as { intent?: unknown; confidence?: unknown };
    const intent = parsed.intent;
    if (intent !== "chat" && intent !== "workspace" && intent !== "analysis") {
      return undefined;
    }
    const confidence =
      typeof parsed.confidence === "number"
        ? Math.min(1, Math.max(0, parsed.confidence))
        : 0.5;
    return { intent, confidence };
  })().catch((error: unknown) => {
    console.warn("DecisionModel classifier failed", error);
    return undefined;
  });
  return Promise.race([run, timeout]);
}

/** Decide how to handle one event. Never throws. */
export async function decide(ai: Ai, event: RouterEvent): Promise<Decision> {
  const started = Date.now();
  const text = event.text.trim();

  // 1. Guardrails.
  if (text.length === 0) return reject("guardrail: empty text", started);
  if (text.length > MAX_TEXT) {
    return reject(`guardrail: text longer than ${MAX_TEXT} chars`, started);
  }
  const blocked = BLOCKED.find((pattern) => pattern.test(text));
  if (blocked) return reject(`guardrail: matched ${blocked}`, started);

  // 2. Keyword rules: a single category with hits, or a lead of 2 or more.
  const scores = score(text);
  const ranked = (Object.entries(scores) as [keyof Scores, number][]).sort(
    (a, b) => b[1] - a[1]
  );
  const [[top, topScore], [, secondScore]] = ranked;
  const reasons = [
    `rules: workspace=${scores.workspace}, analysis=${scores.analysis}`
  ];
  if (topScore > 0 && (secondScore === 0 || topScore - secondScore >= 2)) {
    return decision(top, "rules", 1, reasons, started);
  }
  // Short text with no keyword at all is chat; no need to ask a model.
  if (topScore === 0 && text.length <= 40) {
    return decision("chat", "rules", 0.9, [...reasons, "rules: short text"], started);
  }

  // 3. Small LLM classifier for the rest.
  const classified = await classify(ai, text);
  if (classified) {
    return decision(
      classified.intent,
      "classifier",
      classified.confidence,
      [...reasons, `classifier: ${CLASSIFIER_MODEL} → ${classified.intent}`],
      started
    );
  }

  // 4. Fallback.
  return decision(
    "chat",
    "fallback",
    0.3,
    [...reasons, "fallback: classifier gave no answer"],
    started
  );
}
