import type {
  Api,
  AssistantMessageEventStream,
  Model,
  Provider
} from "@earendil-works/pi-ai";
import { createModels, createProvider } from "@earendil-works/pi-ai/models";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import type { createAI } from "agents/models/pi-ai";

export const MODEL_ID = "z-ai/glm-5.3";

export function openRouterModel(): Model<Api> {
  const catalog = createModels();
  catalog.setProvider(openrouterProvider());
  const model = catalog.getModelOfType("chat", "openrouter", MODEL_ID);
  if (!model) throw new Error(`No OpenRouter model metadata for ${MODEL_ID}`);
  return model;
}

export function gatewayOpenRouterProvider(ai: ReturnType<typeof createAI>, model: Model<Api>): Provider {
  return createProvider({
    id: "openrouter",
    name: "OpenRouter via AI Gateway",
    auth: ai.provider.auth,
    models: [model],
    api: {
      stream: (model, context, options) =>
        ai.stream(ai(model), context, options) as AssistantMessageEventStream,
      streamSimple: (model, context, options) =>
        ai.streamSimple(ai(model), context, options) as AssistantMessageEventStream
    }
  });
}
