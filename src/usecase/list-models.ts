import { DEFAULT_MODEL, MODEL_CHOICES } from "../domain/model-choice";

export function listModels() {
  return {
    default: DEFAULT_MODEL.name,
    models: MODEL_CHOICES.map(({ name, provider, id }) => ({ name, provider, id })),
  };
}
