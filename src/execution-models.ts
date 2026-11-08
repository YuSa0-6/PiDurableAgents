import type {
  Api,
  AssistantMessageEventStream,
  Model,
  Provider
} from "@earendil-works/pi-ai";
import { createModels, createProvider } from "@earendil-works/pi-ai/models";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import type { createAI } from "agents/models/pi-ai";

export const EXECUTION_MODELS = [
  {
    id: "deepseek/deepseek-v4.1-flash",
    label: "DeepSeek V4.1 Flash",
    criteria:
      "Fastest and cheapest. Greetings, small talk, short factual questions, simple arithmetic, quick one-step tool calls."
  },
  {
    id: "z-ai/glm-5.3",
    label: "GLM 5.3",
    criteria:
      "Software engineering and long-horizon agent work: reading, writing and editing files, running code, git, multi-step tool use."
  },
  {
    id: "google/gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    criteria:
      "Balanced and quick reasoning: summaries, explanations, everyday multi-step questions, mixed tasks of moderate difficulty."
  },
  {
    id: "qwen/qwen3.8-max-0902",
    label: "Qwen3.8 Max",
    criteria:
      "Deepest reasoning: architecture and design decisions, comparing options and trade-offs, careful analysis and planning."
  },
  {
    id: "tencent/hy4",
    label: "Tencent Hy4",
    criteria:
      "Long-horizon real-world productivity work: drafting documents, organising information, business writing and multi-part deliverables."
  }
] as const;

export type ExecutionModelId = (typeof EXECUTION_MODELS)[number]["id"];

export const DEFAULT_MODEL: ExecutionModelId = "z-ai/glm-5.3";

export function isExecutionModel(id: string): id is ExecutionModelId {
  return EXECUTION_MODELS.some((model) => model.id === id);
}

const NOT_IN_CATALOG: Record<string, { base: string; cost: Model<Api>["cost"] }> = {
  "tencent/hy4": {
    base: "tencent/hy4-preview",
    cost: { input: 0.42, output: 1.25, cacheRead: 0.042, cacheWrite: 0 }
  }
};

export function executionModels(): Model<Api>[] {
  const catalog = createModels();
  catalog.setProvider(openrouterProvider());
  return EXECUTION_MODELS.map(({ id, label }) => {
    const known = catalog.getModelOfType("chat", "openrouter", id);
    if (known) return known;
    const extra = NOT_IN_CATALOG[id];
    const base = extra && catalog.getModelOfType("chat", "openrouter", extra.base);
    if (!base) throw new Error(`No OpenRouter model metadata for ${id}`);
    return { ...base, id, name: label, cost: extra.cost };
  });
}

type AI = ReturnType<typeof createAI>;

export function gatewayOpenRouterProvider(
  ai: AI,
  models: readonly Model<Api>[]
): Provider {
  return createProvider({
    id: "openrouter",
    name: "OpenRouter via AI Gateway",
    auth: ai.provider.auth,
    models,
    api: {
      stream: (model, context, options) =>
        ai.stream(ai(model), context, options) as AssistantMessageEventStream,
      streamSimple: (model, context, options) =>
        ai.streamSimple(ai(model), context, options) as AssistantMessageEventStream
    }
  });
}
