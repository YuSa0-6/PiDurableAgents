import type { Api, AssistantMessageEventStream, Model, Provider } from "@earendil-works/pi-ai";
import { createModels, createProvider, type Models } from "@earendil-works/pi-ai/models";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import type { createAI } from "agents/models/pi-ai";
import { MODEL_CHOICES, type ModelRef } from "../../domain/model-choice";

type GatewayAI = ReturnType<typeof createAI>;

const CATALOG_PROVIDERS: Readonly<Record<string, () => Provider>> = {
  openrouter: openrouterProvider,
  anthropic: anthropicProvider,
};

const GATEWAY_APIS: ReadonlySet<string> = new Set([
  "openai-completions",
  "anthropic-messages",
  "openai-responses",
]);

export function catalogModel(ref: ModelRef): Model<Api> {
  const provider = CATALOG_PROVIDERS[ref.provider];
  if (!provider) throw new Error(`No catalog for provider ${ref.provider}`);
  const catalog = createModels();
  catalog.setProvider(provider());
  const model = catalog.getModelOfType("chat", ref.provider, ref.id);
  if (!model) throw new Error(`No ${ref.provider} model metadata for ${ref.id}`);
  if (!GATEWAY_APIS.has(model.api)) {
    throw new Error(`AI Gateway cannot route the ${model.api} API of ${ref.provider}/${ref.id}`);
  }
  if (model.cost.input <= 0 || model.cost.output <= 0) {
    throw new Error(`No price for ${ref.provider}/${ref.id}, so the run budget cannot count it`);
  }
  return model;
}

export function gatewayModels(ai: GatewayAI): Models {
  const models = createModels();
  for (const providerId of new Set(MODEL_CHOICES.map((choice) => choice.provider))) {
    const listed = MODEL_CHOICES.filter((choice) => choice.provider === providerId).map(
      catalogModel,
    );
    models.setProvider(
      createProvider({
        id: providerId,
        name: `${providerId} via AI Gateway`,
        auth: ai.provider.auth,
        models: listed,
        api: {
          stream: (model, context, options) =>
            ai.stream(ai(model), context, options) as AssistantMessageEventStream,
          streamSimple: (model, context, options) =>
            ai.streamSimple(ai(model), context, options) as AssistantMessageEventStream,
        },
      }),
    );
  }
  return models;
}
