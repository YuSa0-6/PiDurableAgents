import { InvalidInput } from "./errors";

export type ModelRef = { readonly provider: string; readonly id: string };

export type ModelChoice = ModelRef & { readonly name: string };

export const DEFAULT_MODEL: ModelChoice = {
  name: "glm-5.3",
  provider: "openrouter",
  id: "z-ai/glm-5.3",
};

export const MODEL_CHOICES: readonly ModelChoice[] = [
  DEFAULT_MODEL,
  { name: "deepseek-v4.1-flash", provider: "openrouter", id: "deepseek/deepseek-v4.1-flash" },
  { name: "grok-4.7", provider: "openrouter", id: "x-ai/grok-4.7" },
  { name: "claude-sonnet-5.5", provider: "anthropic", id: "claude-sonnet-5-5" },
  { name: "claude-haiku-5.5", provider: "anthropic", id: "claude-haiku-5-5" },
  { name: "gemini-3.5-flash", provider: "openrouter", id: "google/gemini-3.5-flash" },
];

export function parseModelChoice(value: unknown): ModelChoice | undefined {
  if (value === undefined || value === "") return undefined;
  const choice = MODEL_CHOICES.find((candidate) => candidate.name === value);
  if (!choice) {
    throw new InvalidInput(
      `model must be one of: ${MODEL_CHOICES.map((candidate) => candidate.name).join(", ")}`,
    );
  }
  return choice;
}

export function sameModel(a: ModelRef, b: ModelRef): boolean {
  return a.provider === b.provider && a.id === b.id;
}

export function modelRefOf(choice: ModelRef): ModelRef {
  return { provider: choice.provider, id: choice.id };
}
